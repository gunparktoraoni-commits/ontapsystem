// app/api/marketplace/cart/checkout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { validateCheckoutInput } from "@/server/lib/validators";
import { calculatePriceBreakdown, createPaymentIntent, buildPaymentFailureUrl, buildPaymentSuccessUrl, resolveAppBaseUrl } from "@/server/lib/payment";
import {
  validateAffiliateCode,
  getAffiliateSettings,
  resolveCommissionRate,
} from "@/server/lib/affiliate";
import { PaymentErrorCode, toPaymentErrorResponse } from "@/lib/errors/payment-errors";
import { calculateProductUnitPrice, ProductConfigErrorCode } from "@/lib/pricing/product-pricing.service";
import { Prisma } from "@prisma/client";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function toJsonString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function buildAppBaseUrl(request: NextRequest): string {
  return resolveAppBaseUrl(request);
}

async function requireSession(request: NextRequest) {
  const result = await resolveRequestSession(request);
  if (!result.session) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Authentication required.", requiresAuth: true },
        { status: 401 }
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
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
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
        toPaymentErrorResponse(
          PaymentErrorCode.CHECKOUT_INVALID_REQUEST,
          "Invalid JSON body",
          session.userId.toString()
        ),
        { status: 400 }
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        toPaymentErrorResponse(
          PaymentErrorCode.CHECKOUT_INVALID_REQUEST,
          "Invalid request payload",
          session.userId.toString()
        ),
        { status: 400 }
      );
    }

    const validation = validateCheckoutInput(body as Record<string, unknown>);
    if (!validation.valid) {
      return NextResponse.json(
        toPaymentErrorResponse(
          PaymentErrorCode.CHECKOUT_VALIDATION_FAILED,
          validation.errors[0] ?? "Validation failed",
          session.userId.toString()
        ),
        { status: 400 }
      );
    }

    const {
      paymentMethodId,
      shippingAddress,
      billingAddress,
      notes,
      promoCode,
    } = validation.data!;

    const userId = BigInt(session.userId);

    // ── Load cart ────────────────────────────────────────────────────────────
    const [cartItems, user] = await Promise.all([
      prisma.cartItem.findMany({ where: { user_id: userId } }),
      prisma.user.findUnique({
        where: { user_id: userId },
        select: { email: true, first_name: true },
      }),
    ]);

    if (cartItems.length === 0) {
      return NextResponse.json(
        toPaymentErrorResponse(
          PaymentErrorCode.CHECKOUT_EMPTY_CART,
          "Your cart is empty",
          session.userId.toString()
        ),
        { status: 400 }
      );
    }

    // ── Resolve all items for validation ────────────────────────────────────
    const merchandiseIds = cartItems.filter((c) => c.item_type === "merchandise").map((c) => c.item_id);
    const templateIds = cartItems.filter((c) => c.item_type === "template").map((c) => c.item_id);
    const planIds = cartItems.filter((c) => c.item_type === "subscription_plan").map((c) => c.item_id);

    const [merchandise, templates, plans] = await Promise.all([
      merchandiseIds.length > 0
        ? prisma.merchandise.findMany({ where: { id: { in: merchandiseIds } } })
        : Promise.resolve([]),
      templateIds.length > 0
        ? prisma.theme.findMany({
            where: { id: { in: templateIds } },
            select: { id: true, theme_name: true, price: true, tag: true },
          })
        : Promise.resolve([]),
      planIds.length > 0
        ? prisma.subscriptionPlan.findMany({ where: { id: { in: planIds } } })
        : Promise.resolve([]),
    ]);

    const merchandiseMap = new Map(merchandise.map((m) => [m.id.toString(), m]));
    const templateMap = new Map(templates.map((t) => [t.id.toString(), t]));
    const planMap = new Map(plans.map((p) => [p.id.toString(), p]));

    // Validate each item and compute subtotal
    let subtotal = 0;
    let hasPhysicalItems = false;
    let affiliateDiscount = 0;
    let affiliateMeta: Record<string, unknown> | null = null;
    const validatedItems: Array<{
      cartItem: typeof cartItems[0];
      unitPrice: number;
      name: string;
    }> = [];

    for (const item of cartItems) {
      const idStr = item.item_id.toString();

      if (item.item_type === "merchandise") {
        const product = merchandiseMap.get(idStr);
        if (!product || !product.is_active) {
          return NextResponse.json(
            { success: false, error: `Product "${idStr}" is no longer available.` },
            { status: 409 }
          );
        }
        hasPhysicalItems = true;
        const recalc = await calculateProductUnitPrice(item.item_id, {
          variant: item.variant,
          subscriptionTier: item.subscription_tier,
          logoType: item.logo_type,
        });
        const price = recalc.unitPrice;
        if (Math.abs(Number(item.price_at_time) - price) > 0.01) {
          return NextResponse.json(
            toPaymentErrorResponse(
              PaymentErrorCode.PRICE_MISMATCH,
              "Price mismatch detected.",
              session.userId.toString(),
              { productConfigCode: ProductConfigErrorCode.PRICE_MISMATCH }
            ),
            { status: 409 }
          );
        }
        subtotal += price * item.quantity;
        validatedItems.push({ cartItem: item, unitPrice: price, name: product.name });
      } else if (item.item_type === "template") {
        const template = templateMap.get(idStr);
        if (!template) {
          return NextResponse.json(
            { success: false, error: `Template "${idStr}" not found.` },
            { status: 409 }
          );
        }
        const price = Number(template.price);
        subtotal += price * item.quantity;
        validatedItems.push({ cartItem: item, unitPrice: price, name: template.theme_name });
      } else if (item.item_type === "subscription_plan") {
        const plan = planMap.get(idStr);
        if (!plan || !plan.is_active) {
          return NextResponse.json(
            { success: false, error: `Plan "${idStr}" is not available.` },
            { status: 409 }
          );
        }
        const customData = item.custom_data;
        const billingCycle =
          (customData && typeof customData === "object" && !Array.isArray(customData)
            ? (customData as Record<string, unknown>).billing_cycle
            : undefined) ?? "monthly";
        const price = billingCycle === "yearly" ? Number(plan.price_yearly) : Number(plan.price_monthly);
        subtotal += price * item.quantity;
        validatedItems.push({ cartItem: item, unitPrice: price, name: plan.name });
      }
    }

    // ── Affiliate / referral handling ────────────────────────────────────────
    const rawReferral = (body as any)?.referral_code ?? request.cookies.get("__affiliate_ref")?.value ?? null;
    if (rawReferral && typeof rawReferral === "string") {
      try {
        const affUser = await validateAffiliateCode(rawReferral);
        if (affUser && typeof affUser.user_id !== "undefined") {
          const affUserId = BigInt(affUser.user_id);
          if (affUserId !== userId) {
            const [affSettings, affUserRow] = await Promise.all([
              getAffiliateSettings(Number(affUser.user_id)).catch(() => null),
              prisma.user.findUnique({ where: { user_id: affUserId }, select: { commission_rate: true } }).catch(() => null),
            ]);

            const commissionRate = resolveCommissionRate(
              affUserRow?.commission_rate ? Number(affUserRow.commission_rate) : null,
              affSettings?.commission_rate ? Number(affSettings.commission_rate) : null,
            );
            // Referral codes attribute commission only — no buyer discount.
            affiliateDiscount = 0;
            affiliateMeta = {
              affiliate_user_id: affUserId.toString(),
              affiliate_code: rawReferral,
              commission_rate: commissionRate,
              discount_percent: 0,
              discount_amount: 0,
            };
          }
        }
      } catch (e) {
        console.warn("[checkout] affiliate validation error", e);
      }
    }

    // ── Validate + apply promo code ─────────────────────────────────────────
    let promoDiscount = 0;
    let promoRecord: {
      id: bigint;
      promo_type: string;
      promo_value: Prisma.Decimal | null;
      max_discount_amount: Prisma.Decimal | null;
      min_purchase_amount: Prisma.Decimal | null;
    } | null = null;

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

      if (!promo) {
        return NextResponse.json(
          toPaymentErrorResponse(
            PaymentErrorCode.CHECKOUT_INVALID_PROMO_CODE,
            "Invalid or expired promo code",
            session.userId.toString()
          ),
          { status: 400 }
        );
      }

      if (promo.min_purchase_amount !== null && subtotal < Number(promo.min_purchase_amount)) {
        return NextResponse.json(
          toPaymentErrorResponse(
            PaymentErrorCode.CHECKOUT_PROMO_MIN_PURCHASE,
            `Minimum cart amount of $${Number(promo.min_purchase_amount).toFixed(2)} required for promo code`,
            session.userId.toString()
          ),
          { status: 400 }
        );
      }

      if (promo.usage_limit !== null && promo.usage_count >= promo.usage_limit) {
        return NextResponse.json(
          toPaymentErrorResponse(
            PaymentErrorCode.CHECKOUT_PROMO_USAGE_LIMIT,
            "This promo code has reached its usage limit",
            session.userId.toString()
          ),
          { status: 400 }
        );
      }

      if (promo.per_user_limit !== null) {
        const userUsage = await prisma.shopOrder.count({ where: { user_id: userId, promo_id: promo.id } });
        if (userUsage >= promo.per_user_limit) {
          return NextResponse.json(
            toPaymentErrorResponse(
              PaymentErrorCode.CHECKOUT_PROMO_USER_LIMIT,
              "You have already used this promo code",
              session.userId.toString()
            ),
            { status: 400 }
          );
        }
      }

      if (promo.promo_type === "percentage") {
        promoDiscount = (subtotal * Number(promo.promo_value ?? 0)) / 100;
        if (promo.max_discount_amount !== null) {
          promoDiscount = Math.min(promoDiscount, Number(promo.max_discount_amount));
        }
      } else if (promo.promo_type === "fixed") {
        promoDiscount = Math.min(Number(promo.promo_value ?? 0), subtotal);
      }

      promoDiscount = Math.round(promoDiscount * 100) / 100;
      promoRecord = promo;
    }

    // ── Calculate final totals ──────────────────────────────────────────────
    const totalDiscountAmount = Math.round((promoDiscount + affiliateDiscount) * 100) / 100;
    const breakdown = calculatePriceBreakdown(subtotal, totalDiscountAmount, hasPhysicalItems);
    const sessionId = uuidv4();
    const appBaseUrl = buildAppBaseUrl(request);
    const successRedirectUrl = buildPaymentSuccessUrl(appBaseUrl, { sessionId });
    const failureRedirectUrl = buildPaymentFailureUrl(appBaseUrl, { sessionId });

    console.log("[checkout] successRedirectUrl", successRedirectUrl);
    console.log("[checkout] failureRedirectUrl", failureRedirectUrl);

    // ── Create payment intent ───────────────────────────────────────────────
    let invoiceId: string | null = null;
    let invoiceUrl: string | null = null;

    if (breakdown.totalAmount > 0) {
      let pi = null as Awaited<ReturnType<typeof createPaymentIntent>> | null;
      try {
        pi = await createPaymentIntent(breakdown.totalAmount, "PHP", {
          userId: userId.toString(),
          successRedirectUrl,
          failureRedirectUrl,
        });
      } catch (e) {
        console.error("[createPaymentIntent error]", e);
        return NextResponse.json(
          toPaymentErrorResponse(
            PaymentErrorCode.INVOICE_CREATION_FAILED,
            "Failed to create payment intent. Please try again.",
            session.userId.toString()
          ),
          { status: 500 }
        );
      }

      if (pi) {
        invoiceId = pi.id;
        invoiceUrl = pi.clientSecret;
      }
    }

    const purchaseLogsToCreate = validatedItems.map(({ cartItem, unitPrice, name }) => ({
      user_id: userId,
      purchase_type: cartItem.item_type,
      item_id: cartItem.item_id,
      item_name: name,
      amount: new Prisma.Decimal(unitPrice * cartItem.quantity),
    }));

    const templatePurchasesToCreate = validatedItems
      .filter(({ cartItem }) => cartItem.item_type === "template")
      .map(({ cartItem, unitPrice }) => ({
        user_id: userId,
        template_id: cartItem.item_id,
        price_paid: new Prisma.Decimal(unitPrice),
      }));

    // ── Build line items for persistence (WITH origin_cart_item_id) ─────────
    const lineItems = validatedItems.map(({ cartItem, unitPrice, name }) => ({
      item_type: cartItem.item_type,
      item_id: cartItem.item_id.toString(),
      item_name: name,
      quantity: cartItem.quantity,
      unit_price: unitPrice,
      total_price: unitPrice * cartItem.quantity,
      variant: cartItem.variant,
      subscription_tier: cartItem.subscription_tier,
      logo_type: cartItem.logo_type,
      custom_data: {
        ...(typeof cartItem.custom_data === "object" && cartItem.custom_data !== null ? cartItem.custom_data : {}),
        origin_cart_item_id: cartItem.id.toString(), // ← store original cart item ID for webhook fallback
      },
    }));

    if (affiliateMeta) {
      for (const li of lineItems) {
        (li as any).affiliate = affiliateMeta;
      }
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // ── Create CheckoutSession ──────────────────────────────────────────────
    const checkoutSession = await prisma.checkoutSession.create({
      data: {
        session_id: sessionId,
        user_id: userId,
        cart_snapshot: JSON.stringify(serialize(cartItems)),
        line_items: JSON.stringify(serialize(lineItems)),
        subtotal: new Prisma.Decimal(breakdown.subtotal),
        discount_amount: new Prisma.Decimal(breakdown.discountAmount),
        tax_amount: new Prisma.Decimal(breakdown.taxAmount),
        shipping_amount: new Prisma.Decimal(breakdown.shippingAmount),
        total_amount: new Prisma.Decimal(breakdown.totalAmount),
        currency: "PHP",
        promo_code: promoCode ?? null,
        promo_id: promoRecord?.id ?? null,
        invoice_id: invoiceId,
        status: "pending",
        shipping_address: JSON.stringify(parseJsonObject(shippingAddress)),
        billing_address: JSON.stringify(parseJsonObject(billingAddress)),
        payment_method_id: paymentMethodId ?? null,
        notes: notes ?? null,
        expires_at: expiresAt,
      },
    });

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          session_id: sessionId,
          invoice_url: invoiceUrl,
          total_amount: breakdown.totalAmount,
          currency: "PHP",
          expires_at: expiresAt.toISOString(),
        },
        message: "Checkout session created. Please complete payment.",
      }),
      { status: 201 }
    );
  } catch (err) {
    console.error("[marketplace/cart/checkout POST]", err);
    return NextResponse.json(
      toPaymentErrorResponse(
        PaymentErrorCode.CHECKOUT_PROCESSING_FAILED,
        "An unexpected error occurred during checkout",
        session?.userId?.toString() ?? "unknown"
      ),
      { status: 500 }
    );
  }
}