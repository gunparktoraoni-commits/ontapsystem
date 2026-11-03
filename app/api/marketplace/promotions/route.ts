// GET /api/marketplace/promotions
// Public endpoint — lists active promotions.
// If authenticated, marks promotions already used by the user.
// Rate limit: 60/min per IP.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

function parsePositiveInt(raw: string | null, fallback: number, max?: number): number {
  const n = raw ? Number(raw) : fallback;
  const result = Number.isInteger(n) && n > 0 ? n : fallback;
  return max !== undefined ? Math.min(result, max) : result;
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("marketplace-promotions-list", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  try {
    // Optional auth
    let userId: bigint | null = null;
    const authHeader = request.headers.get("authorization");
    const rawToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (rawToken) {
      const payload = await validateToken(rawToken);
      if (payload?.userId) userId = BigInt(payload.userId);
    }

    const q = request.nextUrl.searchParams;
    const page = parsePositiveInt(q.get("page"), 1);
    const limit = parsePositiveInt(q.get("limit"), 20, 50);
    const skip = (page - 1) * limit;
    const now = new Date();

    const [promotions, total] = await Promise.all([
      prisma.promotion.findMany({
        where: {
          is_active: true,
          starts_at: { lte: now },
          expires_at: { gte: now },
        },
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
      }),
      prisma.promotion.count({
        where: {
          is_active: true,
          starts_at: { lte: now },
          expires_at: { gte: now },
        },
      }),
    ]);

    // Determine per-user usage if authenticated
    let usedPromoIds = new Set<string>();
    if (userId && promotions.length > 0) {
      const promoIds = promotions.map((p) => p.id);
      const usedOrders = await prisma.shopOrder.findMany({
        where: { user_id: userId, promo_id: { in: promoIds } },
        select: { promo_id: true },
      });
      usedPromoIds = new Set(usedOrders.map((o) => o.promo_id?.toString()).filter(Boolean) as string[]);
    }

    return NextResponse.json(serialize({
      success: true,
      data: {
        promotions: promotions.map((p) => {
          const idStr = p.id.toString();
          return {
            id: idStr,
            name: p.promo_name,
            description: p.description,
            promoImg: p.promo_img ?? null,
            redirectPath: p.redirect_path ?? null,
            code: p.code ?? null,
            discountType: p.promo_type,
            discountValue: Number(p.promo_value ?? 0),
            minCartAmount: Number(p.min_purchase_amount ?? 0),
            maxDiscountAmount: p.max_discount_amount !== null ? Number(p.max_discount_amount) : null,
            maxUses: p.usage_limit,
            currentUses: p.usage_count,
            usageRemainingGlobal: p.usage_limit !== null ? p.usage_limit - p.usage_count : null,
            maxUsesPerUser: p.per_user_limit,
            startsAt: p.starts_at,
            expiresAt: p.expires_at,
            usedByCurrentUser: userId ? usedPromoIds.has(idStr) : null,
            isExpired: p.expires_at ? p.expires_at < now : false,
          };
        }),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    }));
  } catch (err) {
    console.error("[marketplace/promotions GET]", err);
    return NextResponse.json({ success: false, error: "An unexpected error occurred." }, { status: 500 });
  }
}
