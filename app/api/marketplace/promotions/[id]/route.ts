// GET /api/marketplace/promotions/[id]
// Optional-auth — returns detail for a single promotion with user eligibility.
// Rate limit: 60/min per IP.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("marketplace-promotion-detail", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  try {
    const { id: rawId } = await params;
    let promoId: bigint;
    try {
      promoId = BigInt(rawId);
    } catch {
      return NextResponse.json({ success: false, error: "Invalid promotion ID." }, { status: 400 });
    }

    // Optional auth
    let userId: bigint | null = null;
    const authHeader = request.headers.get("authorization");
    const rawToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (rawToken) {
      const payload = await validateToken(rawToken);
      if (payload?.userId) userId = BigInt(payload.userId);
    }

    const now = new Date();
    const promo = await prisma.promotion.findFirst({
      where: { id: promoId, is_active: true },
    });

    if (!promo) {
      return NextResponse.json({ success: false, error: "Promotion not found." }, { status: 404 });
    }

    // User eligibility checks
    let userEligibility: {
      eligible: boolean;
      reason: string | null;
      timesUsed: number | null;
    } = { eligible: true, reason: null, timesUsed: null };

    if (userId) {
      const userUsageCount = await prisma.shopOrder.count({
        where: { user_id: userId, promo_id: promoId },
      });
      userEligibility.timesUsed = userUsageCount;

      if (promo.expires_at && promo.expires_at < now) {
        userEligibility = { eligible: false, reason: "Promotion has expired.", timesUsed: userUsageCount };
      } else if (promo.starts_at > now) {
        userEligibility = { eligible: false, reason: "Promotion has not started yet.", timesUsed: userUsageCount };
      } else if (promo.usage_limit !== null && promo.usage_count >= promo.usage_limit) {
        userEligibility = { eligible: false, reason: "Promotion usage limit reached.", timesUsed: userUsageCount };
      } else if (userUsageCount >= promo.per_user_limit) {
        userEligibility = {
          eligible: false,
          reason: `You have already used this promotion ${userUsageCount} time(s).`,
          timesUsed: userUsageCount,
        };
      }
    }

    return NextResponse.json(serialize({
      success: true,
      data: {
        promotion: {
          id: promo.id.toString(),
          name: promo.promo_name,
          description: promo.description,
          code: promo.code ?? null,
          discountType: promo.promo_type,
          discountValue: Number(promo.promo_value ?? 0),
          minCartAmount: Number(promo.min_purchase_amount ?? 0),
          maxDiscountAmount: promo.max_discount_amount !== null ? Number(promo.max_discount_amount) : null,
          maxUses: promo.usage_limit,
          currentUses: promo.usage_count,
          maxUsesPerUser: promo.per_user_limit,
          startsAt: promo.starts_at,
          expiresAt: promo.expires_at,
          isActive: promo.is_active,
          isExpired: promo.expires_at ? promo.expires_at < now : false,
          isStarted: promo.starts_at <= now,
        },
        userEligibility: userId ? userEligibility : null,
      },
    }));
  } catch (err) {
    console.error("[marketplace/promotions/[id] GET]", err);
    return NextResponse.json({ success: false, error: "An unexpected error occurred." }, { status: 500 });
  }
}
