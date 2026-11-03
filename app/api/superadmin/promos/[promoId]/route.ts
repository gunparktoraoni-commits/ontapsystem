import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { type SuperAdminContext, withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { PromoService, type PromoTag, type PromoType, type TargetGroup } from "@/lib/services/promo.service";
import { checkProductPromoRateLimit } from "@/lib/rate-limit/product-promo-limits";
import {
  createProductPromoError,
  ProductPromoErrorCode,
  toProductPromoErrorResponse,
} from "@/lib/errors/product-promo-errors";
import { toProductPromoErrorNextResponse } from "@/lib/errors/product-promo-http";

type RouteContext = Record<string, unknown> & { params: Promise<{ promoId: string }> };

const promoTypeEnum = z.enum([
  "discount",
  "buy_one_get_one",
  "free_shipping",
  "fixed_amount",
  "percentage",
  "free_merch",
]);
const targetGroupEnum = z.enum([
  "newly_registered",
  "new_users",
  "bulk_orders",
  "frequent_buyers",
  "first_time_buyers",
  "all_users",
  "subscription_basic",
  "subscription_standard",
  "subscription_premium",
  "free_trial_users",
  "company_admins",
]);
const promoTagEnum = z.enum(["discount_promo", "bogo", "seasonal", "clearance", "welcome"]);

const updatePromoSchema = z
  .object({
    promo_name: z.string().trim().min(2).max(255).optional(),
    description: z.string().trim().optional(),
    promo_type: promoTypeEnum.optional(),
    promo_img: z.string().trim().max(512).nullable().optional(),
    redirect_path: z.string().trim().max(512).nullable().optional(),
    discount_value: z.number().finite().positive().optional(),
    discount_percentage: z.number().int().min(1).max(100).optional(),
    start_date: z.coerce.date().optional(),
    end_date: z.coerce.date().optional(),
    target_groups: z.array(targetGroupEnum).min(1).optional(),
    tags: z.array(promoTagEnum).min(1).optional(),
    applicable_products: z.array(z.number().int().positive()).optional(),
    minimum_order_amount: z.number().finite().min(0).optional(),
    maximum_discount_amount: z.number().finite().min(0).optional(),
    usage_limit: z.number().int().positive().optional(),
    per_user_limit: z.number().int().positive().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required for update",
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
    const rateLimit = checkProductPromoRateLimit(req, "GET_PROMO", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toProductPromoErrorResponse(
          ProductPromoErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many promo detail requests",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) } }
      );
    }

    const { promoId } = await context.params;
    const parsedPromoId = parsePromoId(promoId, requestId);

    const service = new PromoService(requestId);
    const [promo, stats] = await Promise.all([
      service.getPromoById(parsedPromoId),
      service.getPromoStats(parsedPromoId),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        promo,
        statistics: {
          ...stats,
          remaining_usage: promo.usage_limit !== null ? Math.max(0, promo.usage_limit - promo.usage_count) : null,
          remaining_days: promo.days_remaining,
        },
      },
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
      "Failed to fetch promo"
    );
  }
});

const putHandler = withSuperAdmin(async (req: NextRequest, context: RouteContext & SuperAdminContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkProductPromoRateLimit(req, "UPDATE_PROMO", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toProductPromoErrorResponse(
          ProductPromoErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many promo update requests",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) } }
      );
    }

    const { promoId } = await context.params;
    const parsedPromoId = parsePromoId(promoId, requestId);

    const body = await req.json().catch(() => null);
    const parsed = updatePromoSchema.safeParse(body);
    if (!parsed.success) {
      throw createProductPromoError(
        ProductPromoErrorCode.PROMO_UPDATE_FAILED,
        "Invalid update promo payload",
        400,
        requestId,
        { issues: parsed.error.issues }
      );
    }

    const service = new PromoService(requestId);
    const updated = await service.updatePromo(
      parsedPromoId,
      {
        ...parsed.data,
        promo_type: parsed.data.promo_type as PromoType | undefined,
        promo_img: parsed.data.promo_img ?? undefined,
        redirect_path: parsed.data.redirect_path ?? undefined,
        target_groups: parsed.data.target_groups as TargetGroup[] | undefined,
        tags: parsed.data.tags as PromoTag[] | undefined,
      },
      String(user.id)
    );

    return NextResponse.json({
      success: true,
      data: {
        promo_id: updated.promo_id,
        updated_fields: Object.keys(parsed.data),
        message: "Promo updated successfully",
      },
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
      "Failed to update promo"
    );
  }
});

const deleteHandler = withSuperAdmin(async (req: NextRequest, context: RouteContext & SuperAdminContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkProductPromoRateLimit(req, "DELETE_PROMO", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toProductPromoErrorResponse(
          ProductPromoErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many promo delete requests",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) } }
      );
    }

    const { promoId } = await context.params;
    const parsedPromoId = parsePromoId(promoId, requestId);

    const service = new PromoService(requestId);
    const deleted = await service.deletePromo(parsedPromoId, String(user.id));

    return NextResponse.json({
      success: true,
      message: deleted.message,
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
      "Failed to delete promo"
    );
  }
});

export async function GET(req: NextRequest, context: RouteContext) {
  return getHandler(req, context);
}

export async function PUT(req: NextRequest, context: RouteContext) {
  return putHandler(req, context);
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  return deleteHandler(req, context);
}
