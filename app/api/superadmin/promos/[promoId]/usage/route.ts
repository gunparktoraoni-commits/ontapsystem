import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { type SuperAdminContext, withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { PromoService } from "@/lib/services/promo.service";
import { checkProductPromoRateLimit } from "@/lib/rate-limit/product-promo-limits";
import {
  createProductPromoError,
  ProductPromoErrorCode,
  toProductPromoErrorResponse,
} from "@/lib/errors/product-promo-errors";
import { toProductPromoErrorNextResponse } from "@/lib/errors/product-promo-http";

type RouteContext = Record<string, unknown> & { params: Promise<{ promoId: string }> };

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function parsePromoId(raw: string, requestId: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw createProductPromoError(
      ProductPromoErrorCode.PROMO_NOT_FOUND,
      "Invalid promoId",
      400,
      requestId,
      { promoId: raw }
    );
  }
  return value;
}

const getHandler = withSuperAdmin(async (req: NextRequest, context: RouteContext & SuperAdminContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkProductPromoRateLimit(req, "GET_PROMO_USAGE", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toProductPromoErrorResponse(
          ProductPromoErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many promo usage requests",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) } }
      );
    }

    const { promoId } = await context.params;
    const parsedPromoId = parsePromoId(promoId, requestId);

    const parsedQuery = querySchema.safeParse({
      page: req.nextUrl.searchParams.get("page") ?? "1",
      limit: req.nextUrl.searchParams.get("limit") ?? "20",
    });

    if (!parsedQuery.success) {
      throw createProductPromoError(
        ProductPromoErrorCode.INVALID_DATE_RANGE,
        "Invalid usage query parameters",
        400,
        requestId,
        { issues: parsedQuery.error.issues }
      );
    }

    const service = new PromoService(requestId);
    const usageData = await service.getPromoUsage(parsedPromoId, parsedQuery.data.page, parsedQuery.data.limit);

    return NextResponse.json({
      success: true,
      data: usageData,
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
      "Failed to fetch promo usage"
    );
  }
});

export async function GET(req: NextRequest, context: RouteContext) {
  return getHandler(req, context);
}
