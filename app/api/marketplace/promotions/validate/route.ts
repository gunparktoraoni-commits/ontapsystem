// POST /api/marketplace/promotions/validate
// Auth required — validates a promo code against a cart.
// Returns discount amount, adjusted subtotal, and eligibility status.
// Rate limit: 30/min per IP.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { validatePromoCodeInput } from "@/server/lib/validators";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

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

  const rateCheck = checkRateLimit("marketplace-promo-validate", ip);
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
      return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ success: false, error: "Invalid request payload." }, { status: 400 });
    }

    const validation = validatePromoCodeInput(body as Record<string, unknown>);
    if (!validation.valid) {
      return NextResponse.json({ success: false, error: validation.errors[0] ?? "Validation failed." }, { status: 400 });
    }

    const { promoCode, cartSubtotal } = validation.data!;
    const userId = BigInt(session.userId);
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
      return NextResponse.json(serialize({
        success: true,
        data: {
          valid: false,
          reason: "Invalid or expired promo code.",
          promoCode,
        },
      }));
    }

    // Check global usage limit
    if (promo.usage_limit !== null && promo.usage_count >= promo.usage_limit) {
      return NextResponse.json(serialize({
        success: true,
        data: { valid: false, reason: "This promo code has reached its usage limit.", promoCode },
      }));
    }

    // Check per-user usage
    if (promo.per_user_limit > 0) {
      const userUsage = await prisma.shopOrder.count({
        where: { user_id: userId, promo_id: promo.id },
      });
      if (userUsage >= promo.per_user_limit) {
        return NextResponse.json(serialize({
          success: true,
          data: { valid: false, reason: "You have already used this promo code.", promoCode },
        }));
      }
    }

    // Minimum cart amount check
    const subtotal = cartSubtotal ?? 0;
    if (subtotal < Number(promo.min_purchase_amount ?? 0)) {
      return NextResponse.json(serialize({
        success: true,
        data: {
          valid: false,
          reason: `Minimum cart amount of $${Number(promo.min_purchase_amount ?? 0).toFixed(2)} required for this code.`,
          promoCode,
          minCartAmount: Number(promo.min_purchase_amount ?? 0),
        },
      }));
    }

    // Calculate discount
    let discountAmount = 0;
    if (promo.promo_type === "percentage") {
      discountAmount = (subtotal * Number(promo.promo_value ?? 0)) / 100;
      if (promo.max_discount_amount !== null) {
        discountAmount = Math.min(discountAmount, Number(promo.max_discount_amount));
      }
    } else if (promo.promo_type === "fixed") {
      discountAmount = Math.min(Number(promo.promo_value ?? 0), subtotal);
    }

    discountAmount = Math.round(discountAmount * 100) / 100;
    const adjustedSubtotal = Math.max(0, subtotal - discountAmount);

    return NextResponse.json(serialize({
      success: true,
      data: {
        valid: true,
        promoId: promo.id.toString(),
        promoCode: promo.code,
        discountType: promo.promo_type,
        discountValue: Number(promo.promo_value ?? 0),
        discountAmount,
        originalSubtotal: subtotal,
        adjustedSubtotal,
        description: promo.description,
      },
    }));
  } catch (err) {
    console.error("[marketplace/promotions/validate POST]", err);
    return NextResponse.json({ success: false, error: "An unexpected error occurred." }, { status: 500 });
  }
}
