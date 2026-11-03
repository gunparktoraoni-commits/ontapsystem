import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { type SuperAdminContext, withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { SubscriptionPlanAdminService } from "@/lib/services/subscription-plan-admin.service";
import { checkProductPromoRateLimit } from "@/lib/rate-limit/product-promo-limits";
import {
  createProductPromoError,
  ProductPromoErrorCode,
  toProductPromoErrorResponse,
} from "@/lib/errors/product-promo-errors";
import { toProductPromoErrorNextResponse } from "@/lib/errors/product-promo-http";

type RouteParams = { params: Promise<{ planId: string }> };

function parsePlanId(input: string, requestId: string): number {
  const id = Number.parseInt(input, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw createProductPromoError(
      ProductPromoErrorCode.PRODUCT_NOT_FOUND,
      "Invalid planId",
      400,
      requestId,
      { planId: input }
    );
  }
  return id;
}

const updatePlanSchema = z.object({
  name: z.string().trim().min(2).max(50).optional(),
  tier_code: z.string().trim().min(2).max(20).optional(),
  description: z.string().trim().optional(),
  price_monthly: z.number().finite().min(0).optional(),
  price_yearly: z.number().finite().min(0).optional(),
  features: z.array(z.string().trim().min(1)).optional(),
  place_before_plan_id: z.number().int().positive().nullable().optional(),
  max_virtual_cards: z.number().int().min(0).nullable().optional(),
  max_physical_cards: z.number().int().min(0).nullable().optional(),
  max_themes: z.number().int().min(1).optional(),
  max_associates: z.number().int().min(0).nullable().optional(),
  can_create_company: z.boolean().optional(),
  can_upload_gallery: z.boolean().optional(),
  can_manage_inquiries: z.boolean().optional(),
  can_real_time_analytics: z.boolean().optional(),
  trial_days: z.number().int().min(0).optional(),
  is_trial: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

const getHandler = withSuperAdmin(async (req: NextRequest, context: Record<string, unknown> & SuperAdminContext & RouteParams) => {
  const startedAt = Date.now();
  const { requestId } = context;
  const { planId } = await context.params;

  try {
    const service = new SubscriptionPlanAdminService(requestId);
    const plan = await service.getPlanById(parsePlanId(planId, requestId));

    return NextResponse.json({
      success: true,
      data: plan,
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
      "[SUBSCRIPTION_PLAN_API] Failed to get subscription plan"
    );
  }
});

const putHandler = withSuperAdmin(async (req: NextRequest, context: Record<string, unknown> & SuperAdminContext & RouteParams) => {
  const startedAt = Date.now();
  const { requestId, user } = context;
  const { planId } = await context.params;

  try {
    const rateLimit = checkProductPromoRateLimit(req, "UPDATE_PRODUCT", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toProductPromoErrorResponse(
          ProductPromoErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many subscription plan update requests",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) } }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = updatePlanSchema.safeParse(body);
    if (!parsed.success) {
      throw createProductPromoError(
        ProductPromoErrorCode.PRODUCT_UPDATE_FAILED,
        "Invalid subscription plan update payload",
        400,
        requestId,
        { issues: parsed.error.issues }
      );
    }

    const service = new SubscriptionPlanAdminService(requestId);
    const plan = await service.updatePlan(parsePlanId(planId, requestId), parsed.data);

    return NextResponse.json({
      success: true,
      data: plan,
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
      "[SUBSCRIPTION_PLAN_API] Failed to update subscription plan"
    );
  }
});

const deleteHandler = withSuperAdmin(async (req: NextRequest, context: Record<string, unknown> & SuperAdminContext & RouteParams) => {
  const startedAt = Date.now();
  const { requestId, user } = context;
  const { planId } = await context.params;

  try {
    const rateLimit = checkProductPromoRateLimit(req, "DELETE_PRODUCT", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toProductPromoErrorResponse(
          ProductPromoErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many subscription plan delete requests",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) } }
      );
    }

    const service = new SubscriptionPlanAdminService(requestId);
    const result = await service.deletePlan(parsePlanId(planId, requestId));

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
      "[SUBSCRIPTION_PLAN_API] Failed to delete subscription plan"
    );
  }
});

export const GET = getHandler;
export const PUT = putHandler;
export const DELETE = deleteHandler;
