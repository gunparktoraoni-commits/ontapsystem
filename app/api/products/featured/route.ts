import { NextRequest, NextResponse } from "next/server";
import { ProductService } from "@/lib/services/product.service";
import { toProductPromoErrorNextResponse } from "@/lib/errors/product-promo-http";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

/**
 * GET /api/products/featured
 * Public — returns the top most-purchased active merchandise products.
 * Query: limit (1–12, default 3)
 */
export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const ip = getClientIp(req);

  const rateCheck = checkRateLimit("marketplace-products-list", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)),
        },
      },
    );
  }

  try {
    const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? "3");
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), 12)
      : 3;

    const service = new ProductService(requestId);
    const products = await service.getMostPurchasedProducts(limit);

    return NextResponse.json({
      success: true,
      data: { products },
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return toProductPromoErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to fetch featured products",
    );
  }
}
