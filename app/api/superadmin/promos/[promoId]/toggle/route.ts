// PATCH /api/superadmin/promos/[promoId]/toggle
// Toggles the is_active status of a promotion.
// Requires superadmin authentication.

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

const toggleBodySchema = z.object({
  is_active: z.boolean(),
});

function parsePromoId(raw: string, requestId: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw createProductPromoError(
      ProductPromoErrorCode.PROMO_NOT_FOUND,
      "Invalid promoId",
      400,
      requestId,
      { promoId: raw },
    );
  }
  return value;
}

const patchHandler = withSuperAdmin(
  async (req: NextRequest, context: RouteContext & SuperAdminContext) => {
    const startedAt = Date.now();
    const { requestId, user } = context;

    try {
      const rateLimit = checkProductPromoRateLimit(req, "UPDATE_PROMO", String(user.id));
      if (!rateLimit.success) {
        return NextResponse.json(
          toProductPromoErrorResponse(
            ProductPromoErrorCode.RATE_LIMIT_EXCEEDED,
            "Too many promo toggle requests",
            requestId,
            { retryAfter: rateLimit.retryAfter },
            Date.now() - startedAt,
          ),
          { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) } },
        );
      }

      const { promoId } = await context.params;
      const parsedPromoId = parsePromoId(promoId, requestId);

      const body = await req.json().catch(() => null);
      const parsed = toggleBodySchema.safeParse(body);
      if (!parsed.success) {
        throw createProductPromoError(
          ProductPromoErrorCode.PROMO_UPDATE_FAILED,
          "Request body must include is_active (boolean)",
          400,
          requestId,
          { issues: parsed.error.issues },
        );
      }

      const service = new PromoService(requestId);
      const result = await service.togglePromoStatus(
        parsedPromoId,
        parsed.data.is_active,
        String(user.id),
      );

      return NextResponse.json({
        success: true,
        data: result,
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
        "Failed to toggle promo status",
      );
    }
  },
);

export async function PATCH(req: NextRequest, context: RouteContext) {
  return patchHandler(req, context);
}
