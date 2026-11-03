import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { type SuperAdminContext, withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { ProductService } from "@/lib/services/product.service";
import { checkProductPromoRateLimit } from "@/lib/rate-limit/product-promo-limits";
import {
  createProductPromoError,
  ProductPromoErrorCode,
  toProductPromoErrorResponse,
} from "@/lib/errors/product-promo-errors";
import { toProductPromoErrorNextResponse } from "@/lib/errors/product-promo-http";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  category: z.string().trim().min(1).max(100).optional(),
  search: z.string().trim().min(1).max(255).optional(),
  sort_by: z.enum(["name", "price", "dateAdded"]).optional(),
  sort_dir: z.enum(["asc", "desc"]).optional(),
  include_inactive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

function parseListQuery(req: NextRequest, requestId: string) {
  const result = listQuerySchema.safeParse({
    page: req.nextUrl.searchParams.get("page") ?? "1",
    limit: req.nextUrl.searchParams.get("limit") ?? "20",
    category: req.nextUrl.searchParams.get("category") ?? undefined,
    search: req.nextUrl.searchParams.get("search") ?? undefined,
    sort_by: req.nextUrl.searchParams.get("sort_by") ?? undefined,
    sort_dir: req.nextUrl.searchParams.get("sort_dir") ?? undefined,
    include_inactive: req.nextUrl.searchParams.get("include_inactive") ?? undefined,
  });

  if (!result.success) {
    throw createProductPromoError(
      ProductPromoErrorCode.INVALID_DATE_RANGE,
      "Invalid query parameters",
      400,
      requestId,
      { issues: result.error.issues }
    );
  }

  return result.data;
}

// ------------------------------------------------------------------
// GET handler – superadmin only
// ------------------------------------------------------------------
const getHandler = withSuperAdmin(async (req: NextRequest, context: Record<string, unknown> & SuperAdminContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkProductPromoRateLimit(req, "GET_PRODUCTS", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toProductPromoErrorResponse(
          ProductPromoErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many product list requests",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) },
        }
      );
    }

    const query = parseListQuery(req, requestId);
    const service = new ProductService(requestId);
    const includeInactive = query.include_inactive === true;

    const [result, categories] = await Promise.all([
      service.getAllProducts({ ...query, includeInactive }),
      service.getProductCategories(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        products: result.products,
        pagination: result.pagination,
        categories,
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
      "Failed to fetch products"
    );
  }
});

// ------------------------------------------------------------------
// POST handler – superadmin only
// ------------------------------------------------------------------
const createProductSchema = z.object({
  name: z.string().trim().min(2).max(255),
  price: z.number().finite().min(0),
  description: z.string().trim().min(1),
  frontUrl: z.string().trim().max(512).optional(),
  backUrl: z.string().trim().max(512).optional(),
  imgUrl: z.string().trim().max(512).optional(),
  images: z.array(z.string().trim().min(1).max(512)).max(10).optional(),
  category: z.string().trim().min(1).max(100),
  customPrice: z.number().finite().min(0).nullable().optional(),
  variableBackImg: z.string().trim().max(512).nullable().optional(),
  variableFrontImg: z.string().trim().max(512).nullable().optional(),
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
          "Too many product create requests",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) } }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = createProductSchema.safeParse(body);
    if (!parsed.success) {
      throw createProductPromoError(
        ProductPromoErrorCode.PRODUCT_CREATION_FAILED,
        "Invalid create product payload",
        400,
        requestId,
        { issues: parsed.error.issues }
      );
    }

    const service = new ProductService(requestId);
    const product = await service.createProduct(parsed.data, String(user.id));

    return NextResponse.json(
      {
        success: true,
        data: product,
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
      "Failed to create product"
    );
  }
});

export { getHandler as GET, postHandler as POST };