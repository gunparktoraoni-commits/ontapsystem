import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  validateDirectCheckoutInput,
} from "@/server/lib/validators";
import {
  calculatePriceBreakdown,
  createPaymentIntentDetailed,
  generateOrderNumber,
  getDefaultCurrency,
  buildPaymentFailureUrl,
  buildPaymentSuccessUrl,
  resolvePaymentReturnBaseUrl,
} from "@/server/lib/payment";
import { sendOrderConfirmationEmail } from "@/server/lib/email";
import { notifyAssignedStaffForOrder } from "@/server/lib/notifications";
import { calculateProductUnitPrice } from "@/lib/pricing/product-pricing.service";
import {
  validateAffiliateCode,
  getAffiliateSettings,
  resolveCommissionRate,
} from "@/server/lib/affiliate";
import { attributePaidShopOrderCommission } from "@/server/lib/staff-commission";

// Serialise BigInt to string for JSON response
const serialize = (obj: unknown): unknown =>
  JSON.parse(
    JSON.stringify(obj, (_, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );

function toJsonString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

async function requireSession(request: NextRequest) {
  const result = await resolveRequestSession(request);
  if (!result.session) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Authentication required.", requiresAuth: true },
        { status: 401 },
      ),
    };
  }
  return { ok: true as const, session: result.session };
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("marketplace-direct-checkout", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)),
        },
      },
    );
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const { session } = auth;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body." },
        { status: 400 },
      );
    }

    const bodyRecord = body as Record<string, unknown>;
    const validation = validateDirectCheckoutInput(bodyRecord);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.errors[0] ?? "Validation failed." },
        { status: 400 },
      );
    }

    const input = validation.data;
    const userId = BigInt(session.userId);

    // 1. Resolve the merchandise product
    const product = await prisma.merchandise.findUnique({
      where: { id: input.item.itemId },
    });
    if (!product || !product.is_active) {
      return NextResponse.json(
        { success: false, error: "Product is not available." },
        { status: 409 },
      );
    }

    // 2. Calculate unit price server‑side (with custom_data)
    const priceResult = await calculateProductUnitPrice(input.item.itemId, {
      variant: (input.item.custom_data as any)?.variant ?? null,
      subscriptionTier:
        (input.item.custom_data as any)?.subscription_tier ??
        (input.item.custom_data as any)?.subscriptionTier ??
        null,
      logoType:
        (input.item.custom_data as any)?.logo_type ??
        (input.item.custom_data as any)?.logoType ??
        null,
    });
    const unitPrice = priceResult.unitPrice;
    const subtotal = unitPrice * input.item.quantity;

    // 3. Promo code validation
    let promoDiscount = 0;
    let promoRecord = null;
    if (input.promoCode) {
      const now = new Date();
      const promo = await prisma.promotion.findFirst({
        where: {
          code: input.promoCode,
          is_active: true,
          starts_at: { lte: now },
          expires_at: { gte: now },
        },
      });
      if (!promo) {
        return NextResponse.json(
          { success: false, error: "Invalid or expired promo code." },
          { status: 400 },
        );
      }
      if (promo.min_purchase_amount && subtotal < Number(promo.min_purchase_amount)) {
        return NextResponse.json(
          {
            success: false,
            error: `Minimum purchase of $${Number(promo.min_purchase_amount)} required.`,
          },
          { status: 400 },
        );
      }
      if (promo.promo_type === "percentage") {
        promoDiscount = (subtotal * Number(promo.promo_value ?? 0)) / 100;
        if (promo.max_discount_amount)
          promoDiscount = Math.min(promoDiscount, Number(promo.max_discount_amount));
      } else if (promo.promo_type === "fixed") {
        promoDiscount = Math.min(Number(promo.promo_value ?? 0), subtotal);
      }
      promoDiscount = Math.round(promoDiscount * 100) / 100;
      promoRecord = promo;
    }

    // 4. Affiliate discount (first‑time buyer only)
    let affiliateDiscount = 0;
    let affiliateMeta: Record<string, unknown> | null = null;
    const priorOrderCount = await prisma.shopOrder.count({ where: { user_id: userId } });
    const affiliateEligible = priorOrderCount === 0;
    const bodyReferral =
      typeof input.referralCode === "string" ? input.referralCode.trim() : "";
    const cookieReferral =
      request.cookies.get("__affiliate_ref")?.value?.trim() ?? "";
    const referralCode = bodyReferral || cookieReferral || "";
    const explicitReferralProvided = Boolean(bodyReferral);

    if (referralCode) {
      if (!affiliateEligible) {
        if (explicitReferralProvided) {
          return NextResponse.json(
            {
              success: false,
              error: "Referral code cannot be applied to this order.",
            },
            { status: 400 },
          );
        }
      } else {
        try {
          const affUser = await validateAffiliateCode(referralCode);
          if (!affUser || typeof affUser.user_id === "undefined") {
            if (explicitReferralProvided) {
              return NextResponse.json(
                { success: false, error: "Invalid referral code." },
                { status: 400 },
              );
            }
          } else {
            const affUserId = BigInt(affUser.user_id);
            if (affUserId === userId) {
              if (explicitReferralProvided) {
                return NextResponse.json(
                  {
                    success: false,
                    error: "Referral code cannot be applied to this order.",
                  },
                  { status: 400 },
                );
              }
            } else {
              const [affSettings, affUserRow] = await Promise.all([
                getAffiliateSettings(Number(affUser.user_id)).catch(() => null),
                prisma.user
                  .findUnique({
                    where: { user_id: affUserId },
                    select: { commission_rate: true },
                  })
                  .catch(() => null),
              ]);
              const commissionRate = resolveCommissionRate(
                affUserRow?.commission_rate
                  ? Number(affUserRow.commission_rate)
                  : null,
                affSettings?.commission_rate
                  ? Number(affSettings.commission_rate)
                  : null,
              );
              // Referral codes attribute commission only — no buyer discount.
              affiliateDiscount = 0;
              affiliateMeta = {
                affiliate_user_id: affUserId.toString(),
                affiliate_code: referralCode.toUpperCase(),
                commission_rate: commissionRate,
                discount_percent: 0,
                discount_amount: 0,
              };
            }
          }
        } catch (error) {
          console.warn("[direct-checkout] affiliate validation error", error);
          if (explicitReferralProvided) {
            return NextResponse.json(
              { success: false, error: "Invalid referral code." },
              { status: 400 },
            );
          }
        }
      }
    }

    const totalDiscountAmount = Math.round((promoDiscount + affiliateDiscount) * 100) / 100;
    const hasPhysicalItems = true; // merchandise is physical
    const breakdown = calculatePriceBreakdown(subtotal, totalDiscountAmount, hasPhysicalItems);

    // 5. Fetch user email for invoice
    const user = await prisma.user.findUnique({
      where: { user_id: userId },
      select: { email: true, first_name: true, last_name: true },
    });
    if (!user) {
      return NextResponse.json(
        { success: false, error: "User not found." },
        { status: 404 },
      );
    }

    const orderNumber = generateOrderNumber();
    const currency = getDefaultCurrency();
    const appBaseUrl = resolvePaymentReturnBaseUrl(request, body as Record<string, unknown>);
    const successRedirectUrl = buildPaymentSuccessUrl(appBaseUrl, { orderNumber });
    const failureRedirectUrl = buildPaymentFailureUrl(appBaseUrl, { orderNumber });

    // 6. Create Xendit invoice if total > 0
    let xenditInvoiceId: string | null = null;
    let xenditInvoiceUrl: string | null = null;
    let paymentStatus = "pending_payment";

    if (breakdown.totalAmount > 0) {
      const piResult = await createPaymentIntentDetailed(
        breakdown.totalAmount,
        breakdown.currency,
        {
          userId: userId.toString(),
          orderNumber,
          payerEmail: user.email ?? "customer@example.com",
          customerName: user.first_name ?? "Customer",
          description: `Order ${orderNumber}`,
          successRedirectUrl,
          failureRedirectUrl,
          items: [
            {
              name: product.name,
              quantity: input.item.quantity,
              price: unitPrice,
              category: "merchandise",
            },
          ],
          metadata: {
            source: "direct_checkout",
            userId: userId.toString(),
            orderNumber,
            productId: input.item.itemId.toString(),
          },
        },
      );

      if (piResult.ok) {
        xenditInvoiceId = piResult.payment.id;
        xenditInvoiceUrl = piResult.payment.clientSecret;
      } else {
        return NextResponse.json(
          {
            success: false,
            error: piResult.error,
          },
          { status: 503 },
        );
      }
    } else {
      paymentStatus = "completed";
    }

    // 7. Create order in DB
    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.shopOrder.create({
        data: {
          user_id: userId,
          order_number: orderNumber,
          status: paymentStatus,
          subtotal: breakdown.subtotal,
          discount_amount: breakdown.discountAmount,
          tax_amount: breakdown.taxAmount,
          shipping_amount: breakdown.shippingAmount,
          total_amount: breakdown.totalAmount,
          currency,
          payment_method: "xendit",
          payment_id: xenditInvoiceId,
          promo_id: promoRecord?.id ?? null,
          xendit_payment_id: xenditInvoiceId,
          xendit_invoice_id: xenditInvoiceId,
          xendit_invoice_url: xenditInvoiceUrl,
          xendit_status: paymentStatus === "completed" ? "PAID" : "PENDING",
          shipping_address: toJsonString(input.shipping_address),
          billing_address: toJsonString(input.billing_address),
          notes: input.notes ?? null,
        },
      });

      // Order item
      const itemCustomData: Record<string, unknown> = {
        ...(input.item.custom_data || {}),
        variant: (input.item.custom_data as any)?.variant ?? null,
        subscription_tier: (input.item.custom_data as any)?.subscription_tier ?? null,
        logo_type: (input.item.custom_data as any)?.logo_type ?? null,
        source: "direct_purchase",
      };
      if (affiliateMeta) {
        itemCustomData.affiliate = affiliateMeta;
      }

      await tx.shopOrderItem.create({
        data: {
          order_id: newOrder.id,
          item_type: "merchandise",
          item_id: input.item.itemId,
          item_name: product.name,
          quantity: input.item.quantity,
          unit_price: new Prisma.Decimal(unitPrice),
          total_price: new Prisma.Decimal(unitPrice * input.item.quantity),
          custom_data: toJsonString(itemCustomData),
        },
      });

      // Purchase log if order is completed (free)
      if (paymentStatus === "completed") {
        await tx.purchaseLog.create({
          data: {
            user_id: userId,
            purchase_type: "merchandise",
            item_id: input.item.itemId,
            item_name: product.name,
            amount: new Prisma.Decimal(unitPrice * input.item.quantity),
            order_id: newOrder.id,
            status: "completed",
            metadata: affiliateMeta ? JSON.stringify(affiliateMeta) : null,
          },
        });
      }

      // Increment promo usage
      if (promoRecord) {
        await tx.promotion.update({
          where: { id: promoRecord.id },
          data: { usage_count: { increment: 1 } },
        });
      }

      return newOrder;
    });

    if (paymentStatus === "completed") {
      try {
        await attributePaidShopOrderCommission({
          shopOrderId: order.id,
          buyerUserId: userId,
          orderTotal: Number(order.total_amount ?? breakdown.totalAmount),
          affiliateMetaFromOrder: affiliateMeta,
        });
      } catch (error) {
        console.error("[direct-checkout] staff/affiliate commission failed", error);
      }
    }

    // 8. Async notifications (don't await)
    void notifyAssignedStaffForOrder(userId, order.id, {
      order_number: orderNumber,
      total_amount: breakdown.totalAmount,
      status: order.status,
    }).catch((error) => console.error("[direct-checkout staff notification]", error));

    if (paymentStatus === "completed" && user.email) {
      sendOrderConfirmationEmail(user.email, {
        customerName: user.first_name ?? "Customer",
        orderNumber,
        items: [
          {
            name: product.name,
            quantity: input.item.quantity,
            unitPrice,
            totalPrice: unitPrice * input.item.quantity,
            type: "merchandise",
          },
        ],
        subtotal: breakdown.subtotal,
        discountAmount: breakdown.discountAmount,
        taxAmount: breakdown.taxAmount,
        shippingAmount: breakdown.shippingAmount,
        totalAmount: breakdown.totalAmount,
        currency: breakdown.currency,
      }).catch((e) => console.error("[direct-checkout email]", e));
    }

    // 9. Response
    return NextResponse.json(
      serialize({
        success: true,
        data: {
          order: {
            id: order.id.toString(),
            orderNumber,
            status: order.status,
            subtotal: breakdown.subtotal,
            discountAmount: breakdown.discountAmount,
            taxAmount: breakdown.taxAmount,
            shippingAmount: breakdown.shippingAmount,
            totalAmount: breakdown.totalAmount,
            paymentIntentId: xenditInvoiceId,
            invoiceUrl: xenditInvoiceUrl,
            requiresPayment: breakdown.totalAmount > 0,
            createdAt: order.placed_at,
          },
        },
        message:
          breakdown.totalAmount > 0
            ? "Order created. Complete payment to confirm."
            : "Order completed successfully.",
      }),
      { status: 201 },
    );
  } catch (err) {
    console.error("[direct-checkout POST]", err);
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred." },
      { status: 500 },
    );
  }
}