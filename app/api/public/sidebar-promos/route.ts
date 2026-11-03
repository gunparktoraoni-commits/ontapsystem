// GET /api/public/sidebar-promos
// Lightweight public endpoint used by the PortalSidebar to fetch active promos for the promo slider.
// Returns only the minimal fields needed to render slides: id, name, description, promo_img, redirect_path,
// promo_type, discount_value, discount_percentage, expires_at.
// Rate limit: 60 req/min per IP.
// No authentication required — promos are publicly visible by design.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

// Only the fields the slider needs — keeps the payload small.
type SidebarPromoSlide = {
  id: string;
  name: string;
  description: string | null;
  promoImg: string | null;
  redirectPath: string | null;
  promoType: string;
  discountValue: number | null;
  discountPercentage: number | null;
  expiresAt: string;
  badge: string | null;
};

function buildBadge(
  promoType: string,
  discountValue: number | null,
  discountPercentage: number | null,
): string | null {
  switch (promoType) {
    case "percentage":
      return discountPercentage !== null ? `${discountPercentage}% OFF` : null;
    case "fixed_amount":
    case "discount":
      return discountValue !== null ? `₱${discountValue.toFixed(0)} OFF` : null;
    case "buy_one_get_one":
      return "BOGO";
    case "free_shipping":
      return "FREE SHIPPING";
    case "free_merch":
      return "FREE MERCH";
    default:
      return null;
  }
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("public-sidebar-promos", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
      },
    );
  }

  try {
    const now = new Date();

    const rows = await prisma.promotion.findMany({
      where: {
        is_active: true,
        starts_at: { lte: now },
        expires_at: { gte: now },
      },
      select: {
        id: true,
        promo_name: true,
        description: true,
        promo_img: true,
        redirect_path: true,
        promo_type: true,
        discount_value: true,
        discount_percentage: true,
        expires_at: true,
      },
      orderBy: { created_at: "desc" },
      take: 10, // Hard cap — sidebar only needs a small carousel
    });

    const slides: SidebarPromoSlide[] = rows.map((row) => {
      const discountValue = row.discount_value !== null ? Number(row.discount_value) : null;
      const discountPercentage = row.discount_percentage;

      return {
        id: row.id.toString(),
        name: row.promo_name,
        description: row.description,
        promoImg: row.promo_img ?? null,
        redirectPath: row.redirect_path ?? null,
        promoType: row.promo_type,
        discountValue,
        discountPercentage,
        expiresAt: row.expires_at.toISOString(),
        badge: buildBadge(row.promo_type, discountValue, discountPercentage),
      };
    });

    return NextResponse.json(
      { success: true, data: { slides, count: slides.length } },
      {
        status: 200,
        headers: {
          // Cache for 60 seconds at the CDN/browser level — promos don't need real-time freshness.
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
        },
      },
    );
  } catch (err) {
    console.error("[public/sidebar-promos GET]", err);
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred." },
      { status: 500 },
    );
  }
}
