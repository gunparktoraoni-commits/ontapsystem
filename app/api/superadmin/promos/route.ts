import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { type SuperAdminContext, withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { PromoService, type PromoType, type PromoTag, type TargetGroup } from "@/lib/services/promo.service";
import { checkProductPromoRateLimit } from "@/lib/rate-limit/product-promo-limits";
import {
  createProductPromoError,
  ProductPromoErrorCode,
  toProductPromoErrorResponse,
} from "@/lib/errors/product-promo-errors";
import { toProductPromoErrorNextResponse } from "@/lib/errors/product-promo-http";

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

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  is_active: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  promo_type: promoTypeEnum.optional(),
  search: z.string().trim().min(1).max(255).optional(),
  sort_by: z.enum(["promo_name", "starts_at", "expires_at", "created_at"]).optional(),
  sort_dir: z.enum(["asc", "desc"]).optional(),
});

const createPromoSchema = z.object({
  promo_name: z.string().trim().min(2).max(255),
  description: z.string().trim().optional(),
  promo_type: promoTypeEnum,
  promo_img: z.string().trim().max(512).optional(),
  redirect_path: z.string().trim().max(512).optional(),
  discount_value: z.number().finite().positive().optional(),
  discount_percentage: z.number().int().min(1).max(100).optional(),
  start_date: z.coerce.date(),
  end_date: z.coerce.date(),
  target_groups: z.array(targetGroupEnum).min(1),
  tags: z.array(promoTagEnum).min(1),
  applicable_products: z.array(z.number().int().positive()).optional(),
  minimum_order_amount: z.number().finite().min(0).optional(),
  maximum_discount_amount: z.number().finite().min(0).optional(),
  usage_limit: z.number().int().positive().optional(),
  per_user_limit: z.number().int().positive().optional(),
});

function parseListQuery(req: NextRequest, requestId: string) {
  const parsed = listQuerySchema.safeParse({
    page: req.nextUrl.searchParams.get("page") ?? "1",
    limit: req.nextUrl.searchParams.get("limit") ?? "20",
    is_active: req.nextUrl.searchParams.get("is_active") ?? undefined,
    promo_type: req.nextUrl.searchParams.get("promo_type") ?? undefined,
    search: req.nextUrl.searchParams.get("search") ?? undefined,
    sort_by: req.nextUrl.searchParams.get("sort_by") ?? undefined,
    sort_dir: req.nextUrl.searchParams.get("sort_dir") ?? undefined,
  });

  if (!parsed.success) {
    throw createProductPromoError(
      ProductPromoErrorCode.INVALID_DATE_RANGE,
      "Invalid promo list query",
      400,
      requestId,
      { issues: parsed.error.issues }
    );
  }

  return parsed.data;
}

const getHandler = withSuperAdmin(async (req: NextRequest, context: Record<string, unknown> & SuperAdminContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkProductPromoRateLimit(req, "GET_PROMOS", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toProductPromoErrorResponse(
          ProductPromoErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many promo list requests",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) } }
      );
    }

    const query = parseListQuery(req, requestId);
    const service = new PromoService(requestId);
    const result = await service.getAllPromos({
      page: query.page,
      limit: query.limit,
      is_active: query.is_active,
      promo_type: query.promo_type as PromoType | undefined,
      search: query.search,
      sort_by: query.sort_by,
      sort_dir: query.sort_dir,
    });

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
      "Failed to fetch promos"
    );
  }
});

const postHandler = withSuperAdmin(async (req: NextRequest, context: Record<string, unknown> & SuperAdminContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkProductPromoRateLimit(req, "CREATE_PROMO", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toProductPromoErrorResponse(
          ProductPromoErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many promo create requests",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) } }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = createPromoSchema.safeParse(body);
    if (!parsed.success) {
      throw createProductPromoError(
        ProductPromoErrorCode.PROMO_CREATION_FAILED,
        "Invalid create promo payload",
        400,
        requestId,
        { issues: parsed.error.issues }
      );
    }

    const service = new PromoService(requestId);
    const created = await service.createPromo(
      {
        ...parsed.data,
        promo_img: parsed.data.promo_img,
        redirect_path: parsed.data.redirect_path,
        target_groups: parsed.data.target_groups as TargetGroup[],
        tags: parsed.data.tags as PromoTag[],
      },
      String(user.id)
    );

    return NextResponse.json(
      {
        success: true,
        data: {
          promo_id: created.promo_id,
          promo_name: created.promo_name,
          message: "Promo created successfully",
        },
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
      "Failed to create promo"
    );
  }
});

export async function GET(req: NextRequest, context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }) {
  return getHandler(req, context);
}

export async function POST(req: NextRequest, context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }) {
  return postHandler(req, context);
}
