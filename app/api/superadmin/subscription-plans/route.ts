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

const createPlanSchema = z.object({
  name: z.string().trim().min(2).max(50),
  tier_code: z.string().trim().min(2).max(20),
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
});

const getHandler = withSuperAdmin(async (req: NextRequest, context: Record<string, unknown> & SuperAdminContext) => {
  const startedAt = Date.now();
  const { requestId } = context;

  try {
    const includeInactive = req.nextUrl.searchParams.get("include_inactive") !== "false";
    const service = new SubscriptionPlanAdminService(requestId);
    const plans = await service.listPlans(includeInactive);

    return NextResponse.json({
      success: true,
      data: { plans },
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
      "[SUBSCRIPTION_PLAN_API] Failed to list subscription plans"
    );
  }
});

const postHandler = withSuperAdmin(async (req: NextRequest, context: Record<string, unknown> & SuperAdminContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkProductPromoRateLimit(req, "CREATE_PRODUCT", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toProductPromoErrorResponse(
          ProductPromoErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many subscription plan create requests",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) } }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = createPlanSchema.safeParse(body);
    if (!parsed.success) {
      throw createProductPromoError(
        ProductPromoErrorCode.PRODUCT_CREATION_FAILED,
        "Invalid subscription plan payload",
        400,
        requestId,
        { issues: parsed.error.issues }
      );
    }

    const service = new SubscriptionPlanAdminService(requestId);
    const plan = await service.createPlan(parsed.data);

    return NextResponse.json(
      {
        success: true,
        data: plan,
        meta: {
          requestId,
          responseTime: Date.now() - startedAt,
          timestamp: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return toProductPromoErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "[SUBSCRIPTION_PLAN_API] Failed to create subscription plan"
    );
  }
});

export async function GET(req: NextRequest, context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }) {
  return getHandler(req, context);
}

export async function POST(req: NextRequest, context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }) {
  return postHandler(req, context);
}
