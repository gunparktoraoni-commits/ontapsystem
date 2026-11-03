// app/api/marketplace/cart/checkout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { validateCheckoutInput } from "@/server/lib/validators";
import { sanitizeString } from "@/server/lib/validators";
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
import { calculateProductUnitPrice, ProductConfigErrorCode } from "@/lib/pricing/product-pricing.service";
import {
  validateAffiliateCode,
  getAffiliateSettings,
  resolveCommissionRate,
} from "@/server/lib/affiliate";
import { attributePaidShopOrderCommission } from "@/server/lib/staff-commission";

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
  const rateCheck = checkRateLimit("marketplace-checkout", ip);
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
    const validation = validateCheckoutInput(bodyRecord);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.errors[0] ?? "Validation failed." },
        { status: 400 },
      );
    }

    const {
      shippingAddress,
      billingAddress,
      notes,
      promoCode,
      selectedItemIds,
    } = validation.data!;
    const bodyReferralCode =
      sanitizeString(bodyRecord.referral_code) ??
      sanitizeString(bodyRecord.referralCode);
    const cookieReferralCode = sanitizeString(
      request.cookies.get("__affiliate_ref")?.value ?? null,
    );
    const referralCode = bodyReferralCode ?? cookieReferralCode;
    const explicitReferralProvided = Boolean(bodyReferralCode);
    const userId = BigInt(session.userId);
    const priorOrderCount = await prisma.shopOrder.count({ where: { user_id: userId } });
    const affiliateEligible = priorOrderCount === 0;

    const [cartItems, user] = await Promise.all([
      prisma.cartItem.findMany({ where: { user_id: userId } }),
      prisma.user.findUnique({
        where: { user_id: userId },
        select: { email: true, first_name: true, last_name: true },
      }),
    ]);

    // Filter to selected items if provided
    const selectedCartItems = selectedItemIds
      ? cartItems.filter(item => selectedItemIds.includes(item.id.toString()))
      : cartItems;

    if (selectedCartItems.length === 0) {
      return NextResponse.json(
        { success: false, error: "No items selected for checkout." },
        { status: 400 },
      );
    }

    // Resolve items and calculate totals
    const merchandiseIds = selectedCartItems
      .filter((c) => c.item_type === "merchandise")
      .map((c) => c.item_id);
    const templateIds = selectedCartItems
      .filter((c) => c.item_type === "template")
      .map((c) => c.item_id);
    const planIds = selectedCartItems
      .filter((c) => c.item_type === "subscription_plan")
      .map((c) => c.item_id);

    const [merchandise, templates, plans] = await Promise.all([
      merchandiseIds.length
        ? prisma.merchandise.findMany({ where: { id: { in: merchandiseIds } } })
        : [],
      templateIds.length
        ? prisma.theme.findMany({
            where: { id: { in: templateIds } },
            select: { id: true, theme_name: true, price: true, tag: true },
          })
        : [],
      planIds.length
        ? prisma.subscriptionPlan.findMany({ where: { id: { in: planIds } } })
        : [],
    ]);

    const merchandiseMap = new Map(
      merchandise.map((m) => [m.id.toString(), m]),
    );
    const templateMap = new Map(templates.map((t) => [t.id.toString(), t]));
    const planMap = new Map(plans.map((p) => [p.id.toString(), p]));

    let subtotal = 0;
    let hasPhysicalItems = false;
    const validatedItems: Array<{
      cartItem: (typeof selectedCartItems)[0];
      unitPrice: number;
      name: string;
    }> = [];

    for (const item of selectedCartItems) {
      const idStr = item.item_id.toString();

      if (item.item_type === "merchandise") {
        const product = merchandiseMap.get(idStr);
        if (!product?.is_active)
          return NextResponse.json(
            { success: false, error: `Product is no longer available.` },
            { status: 409 },
          );
        hasPhysicalItems = true;
        const merchandiseItem = item as any;
        const recalc = await calculateProductUnitPrice(item.item_id, {
          variant: merchandiseItem.variant,
          subscriptionTier: merchandiseItem.subscription_tier,
          logoType: merchandiseItem.logo_type,
        });
        const price = recalc.unitPrice;
        if (Math.abs(Number(item.price_at_time) - price) > 0.01) {
          return NextResponse.json(
            {
              success: false,
              error: "Price mismatch detected.",
              code: ProductConfigErrorCode.PRICE_MISMATCH,
            },
            { status: 409 },
          );
        }
        subtotal += price * item.quantity;
        validatedItems.push({
          cartItem: item,
          unitPrice: price,
          name: product.name,
        });
      } else if (item.item_type === "template") {
        const template = templateMap.get(idStr);
        if (!template)
          return NextResponse.json(
            { success: false, error: `Template not found.` },
            { status: 409 },
          );
        const price = Number(template.price);
        subtotal += price * item.quantity;
        validatedItems.push({
          cartItem: item,
          unitPrice: price,
          name: template.theme_name,
        });
      } else if (item.item_type === "subscription_plan") {
        const plan = planMap.get(idStr);
        if (!plan?.is_active)
          return NextResponse.json(
            { success: false, error: `Plan is not available.` },
            { status: 409 },
          );
        const customData = item.custom_data as Record<string, unknown> | null;
        const billingCycle =
          customData?.billing_cycle === "yearly" ? "yearly" : "monthly";
        const price =
          billingCycle === "yearly"
            ? Number(plan.price_yearly)
            : Number(plan.price_monthly);
        subtotal += price * item.quantity;
        validatedItems.push({
          cartItem: item,
          unitPrice: price,
          name: plan.name,
        });
      }
    }

    let affiliateDiscount = 0;
    let affiliateMeta: Record<string, unknown> | null = null;
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
              // Discounts come only from vouchers/promos (e.g. superadmin gifts).
              affiliateDiscount = 0;
              affiliateMeta = {
                affiliate_user_id: affUserId.toString(),
                affiliate_code: referralCode.trim().toUpperCase(),
                commission_rate: commissionRate,
                discount_percent: 0,
                discount_amount: 0,
              };
            }
          }
        } catch (error) {
          console.warn(
            "[marketplace/checkout] affiliate validation error",
            error,
          );
          if (explicitReferralProvided) {
            return NextResponse.json(
              { success: false, error: "Invalid referral code." },
              { status: 400 },
            );
          }
        }
      }
    }

    // Promo code validation
    let promoDiscount = 0;
    let promoRecord = null;
    if (promoCode) {
      const now = new Date();
      const promo = await prisma.promotion.findFirst({
        where: {
          code: promoCode,
          is_active: true,
          starts_at: { lte: now },
          expires_at: { gte: now },
        },
      });
      if (!promo)
        return NextResponse.json(
          { success: false, error: "Invalid or expired promo code." },
          { status: 400 },
        );
      if (
        promo.min_purchase_amount &&
        subtotal < Number(promo.min_purchase_amount)
      ) {
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
          promoDiscount = Math.min(
            promoDiscount,
            Number(promo.max_discount_amount),
          );
      } else if (promo.promo_type === "fixed") {
        promoDiscount = Math.min(Number(promo.promo_value ?? 0), subtotal);
      }
      promoDiscount = Math.round(promoDiscount * 100) / 100;
      promoRecord = promo;
    }

    const totalDiscountAmount =
      Math.round((promoDiscount + affiliateDiscount) * 100) / 100;
    const breakdown = calculatePriceBreakdown(
      subtotal,
      totalDiscountAmount,
      hasPhysicalItems,
    );
    const orderNumber = generateOrderNumber();
    const currency = getDefaultCurrency();
    const appBaseUrl = resolvePaymentReturnBaseUrl(request, bodyRecord);

    const successRedirectUrl = buildPaymentSuccessUrl(appBaseUrl, { orderNumber });
    const failureRedirectUrl = buildPaymentFailureUrl(appBaseUrl, { orderNumber });

    // Create Xendit invoice if total > 0
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
          payerEmail: user?.email ?? "customer@example.com",
          customerName: user?.first_name ?? "Customer",
          description: `Order ${orderNumber}`,
          successRedirectUrl,
          failureRedirectUrl,
          items: validatedItems.map((item) => ({
            name: item.name,
            quantity: item.cartItem.quantity,
            price: item.unitPrice,
            category: item.cartItem.item_type,
          })),
          metadata: {
            source: "cart_checkout",
            userId: userId.toString(),
            orderNumber,
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

    // Create order in database
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
          shipping_address: toJsonString(shippingAddress),
          billing_address: toJsonString(billingAddress),
          notes: notes ?? null,
        },
      });

      // Create order items
      for (const { cartItem, unitPrice, name } of validatedItems) {
        const orderCartItem = cartItem as any;
        const baseCustomData =
          typeof orderCartItem.custom_data === "object" &&
          orderCartItem.custom_data !== null &&
          !Array.isArray(orderCartItem.custom_data)
            ? (orderCartItem.custom_data as Record<string, unknown>)
            : {};
        const itemCustomData: Record<string, unknown> = {
          ...baseCustomData,
          variant: orderCartItem.variant,
          subscription_tier: orderCartItem.subscription_tier ?? null,
          logo_type: orderCartItem.logo_type ?? null,
          origin_cart_item_id: orderCartItem.id ? String(orderCartItem.id) : null,
          bizcardSerialId: orderCartItem.bizcardSerialId || null,
        };
        if (affiliateMeta) {
          itemCustomData.affiliate = affiliateMeta;
        }
        await tx.shopOrderItem.create({
          data: {
            order_id: newOrder.id,
            item_type: cartItem.item_type,
            item_id: cartItem.item_id,
            item_name: name,
            quantity: cartItem.quantity,
            unit_price: new Prisma.Decimal(unitPrice),
            total_price: new Prisma.Decimal(unitPrice * cartItem.quantity),
            custom_data: toJsonString(itemCustomData),
          },
        });
      }

      // Create purchase logs for completed orders (no payment required)
      if (paymentStatus === "completed") {
        await tx.purchaseLog.createMany({
          data: validatedItems.map(({ cartItem, unitPrice, name }) => ({
            user_id: userId,
            purchase_type: cartItem.item_type,
            item_id: cartItem.item_id,
            item_name: name,
            amount: new Prisma.Decimal(unitPrice * cartItem.quantity),
            order_id: newOrder.id,
            status: "completed",
            metadata: affiliateMeta
              ? JSON.stringify({
                  referral_code: referralCode,
                  affiliate_user_id: affiliateMeta.affiliate_user_id,
                })
              : null,
          })),
        });
      }

      // Create template purchases for templates
      const templatePurchases = validatedItems
        .filter(({ cartItem }) => cartItem.item_type === "template")
        .map(({ cartItem, unitPrice }) => ({
          user_id: userId,
          template_id: cartItem.item_id,
          price_paid: new Prisma.Decimal(unitPrice),
          order_id: newOrder.id,
        }));

      if (paymentStatus === "completed" && templatePurchases.length) {
        await tx.templatePurchase.createMany({
          data: templatePurchases,
          skipDuplicates: true,
        });
      }

      // Handle subscription plans in cart
      const subscriptionItems = validatedItems.filter(
        ({ cartItem }) => cartItem.item_type === "subscription_plan",
      );
      for (const { cartItem } of subscriptionItems) {
        const plan = await tx.subscriptionPlan.findUnique({
          where: { id: cartItem.item_id },
        });
        if (plan) {
          const customData = cartItem.custom_data as Record<string, unknown> | null;
          const bizcardSerialId = customData?.bizcardSerialId as string | undefined;
          if (!bizcardSerialId) {
            // If no bizcardSerialId, we cannot assign subscription. We could create a pending subscription without a bizcard? But that doesn't fit the model.
            // We'll skip or throw an error.
            console.warn("Subscription plan added to cart without bizcardSerialId");
            continue;
          }
          const bizcard = await tx.bizcard.findFirst({
            where: { serial_id: bizcardSerialId, user_id: userId },
          });
          if (!bizcard) {
            // bizcard not found, skip.
            continue;
          }
          const now = new Date();
          const expires = new Date(now);
          const billingCycle =
            (customData?.billing_cycle as string) === "yearly" ? "yearly" : "monthly";
          if (billingCycle === "yearly") expires.setFullYear(expires.getFullYear() + 1);
          else expires.setMonth(expires.getMonth() + 1);

          await tx.bizcardSubscription.upsert({
            where: { bizcard_id: bizcard.bizcard_id },
            update: {
              plan_id: plan.id,
              status: paymentStatus === "completed" ? "active" : "pending",
              billing_cycle: billingCycle,
              started_at: now,
              expires_at: expires,
              auto_renew: true,
              xendit_invoice_id: xenditInvoiceId,
            },
            create: {
              bizcard_id: bizcard.bizcard_id,
              plan_id: plan.id,
              status: paymentStatus === "completed" ? "active" : "pending",
              billing_cycle: billingCycle,
              started_at: now,
              expires_at: expires,
              auto_renew: true,
              xendit_invoice_id: xenditInvoiceId,
            },
          });

          // Update bizcard denormalized fields
          await tx.bizcard.update({
            where: { bizcard_id: bizcard.bizcard_id },
            data: {
              subscription_tier: plan.tier_code,
              subscription_started_at: now,
              subscription_expires_at: expires,
              subscription_status: paymentStatus === "completed" ? "active" : "pending_activation",
            },
          });
        }
      }

      // Increment promo usage
      if (promoRecord) {
        await tx.promotion.update({
          where: { id: promoRecord.id },
          data: { usage_count: { increment: 1 } },
        });
      }

      // Clear selected cart items if order completed immediately
      if (paymentStatus === "completed") {
        await tx.cartItem.deleteMany({ where: { user_id: userId, id: { in: selectedCartItems.map(item => item.id) } } });
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
        console.error("[marketplace/checkout] staff/affiliate commission failed", error);
      }
    }

    void notifyAssignedStaffForOrder(userId, order.id, {
      order_number: orderNumber,
      total_amount: breakdown.totalAmount,
      status: order.status,
    }).catch((error) => console.error("[checkout staff notification]", error));

    // Send email for completed orders
    if (user && paymentStatus === "completed") {
      sendOrderConfirmationEmail(user.email, {
        customerName: user.first_name ?? "Customer",
        orderNumber,
        items: validatedItems.map(({ name, cartItem, unitPrice }) => ({
          name,
          quantity: cartItem.quantity,
          unitPrice,
          totalPrice: unitPrice * cartItem.quantity,
          type:
            cartItem.item_type === "subscription_plan"
              ? "subscription"
              : (cartItem.item_type as "merchandise" | "template"),
        })),
        subtotal: breakdown.subtotal,
        discountAmount: breakdown.discountAmount,
        taxAmount: breakdown.taxAmount,
        shippingAmount: breakdown.shippingAmount,
        totalAmount: breakdown.totalAmount,
        currency: breakdown.currency,
      }).catch((e) => console.error("[checkout email]", e));
    }

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
    console.error("[marketplace/cart/checkout POST]", err);
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred." },
      { status: 500 },
    );
  }
}