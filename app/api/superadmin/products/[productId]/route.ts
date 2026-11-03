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
import { validateToken } from "@/server/lib/auth";
import { cookies } from "next/headers";

type RouteContext = { params: Promise<{ productId: string }> };

function parseProductId(input: string, requestId: string): number {
  const id = Number.parseInt(input, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw createProductPromoError(
      ProductPromoErrorCode.PRODUCT_NOT_FOUND,
      "Invalid productId",
      400,
      requestId,
      { productId: input }
    );
  }
  return id;
}

// ------------------------------------------------------------------
// GET handler – accessible to any authenticated user (all roles)
// ------------------------------------------------------------------
export async function GET(req: NextRequest, { params }: RouteContext) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();

  try {
    // Authenticate user
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("session_token")?.value;
    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Please log in" },
        { status: 401 }
      );
    }

    const session = await validateToken(accessToken);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Session expired or invalid" },
        { status: 401 }
      );
    }

    // Rate limiting per user
    const rateLimit = checkProductPromoRateLimit(req, "GET_PRODUCT", String(session.userId));
    if (!rateLimit.success) {
      return NextResponse.json(
        toProductPromoErrorResponse(
          ProductPromoErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many product detail requests",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) } }
      );
    }

    const { productId } = await params;
    const parsedId = parseProductId(productId, requestId);

    const service = new ProductService(requestId);
    const product = await service.getProductById(parsedId);

    return NextResponse.json({
      success: true,
      data: product,
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
      "Failed to fetch product"
    );
  }
}

// ------------------------------------------------------------------
// PUT handler – superadmin only
// ------------------------------------------------------------------
const updateProductSchema = z.object({
  name: z.string().trim().min(2).max(255).optional(),
  price: z.number().finite().min(0).optional(),
  description: z.string().trim().min(1).optional(),
  frontUrl: z.string().trim().max(512).optional(),
  backUrl: z.string().trim().max(512).optional(),
  imgUrl: z.string().trim().max(512).optional(),
  images: z.array(z.string().trim().min(1).max(512)).max(10).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  customPrice: z.number().finite().min(0).nullable().optional(),
  variableBackImg: z.string().trim().max(512).nullable().optional(),
  variableFrontImg: z.string().trim().max(512).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required for update",
});

const putHandler = withSuperAdmin(async (req: NextRequest, context: RouteContext & SuperAdminContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkProductPromoRateLimit(req, "UPDATE_PRODUCT", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toProductPromoErrorResponse(
          ProductPromoErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many product update requests",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) } }
      );
    }

    const { productId } = await context.params;
    const parsedId = parseProductId(productId, requestId);

    const body = await req.json().catch(() => null);
    const parsed = updateProductSchema.safeParse(body);
    if (!parsed.success) {
      throw createProductPromoError(
        ProductPromoErrorCode.PRODUCT_UPDATE_FAILED,
        "Invalid update payload",
        400,
        requestId,
        { issues: parsed.error.issues }
      );
    }

    const service = new ProductService(requestId);
    const updated = await service.updateProduct(parsedId, parsed.data, String(user.id));

    return NextResponse.json({
      success: true,
      data: updated,
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
      "Failed to update product"
    );
  }
});

// ------------------------------------------------------------------
// DELETE handler – superadmin only
// ------------------------------------------------------------------
const deleteHandler = withSuperAdmin(async (req: NextRequest, context: RouteContext & SuperAdminContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkProductPromoRateLimit(req, "DELETE_PRODUCT", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toProductPromoErrorResponse(
          ProductPromoErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many product delete requests",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) } }
      );
    }

    const { productId } = await context.params;
    const parsedId = parseProductId(productId, requestId);
    const permanent = req.nextUrl.searchParams.get("permanent") === "true";

    const service = new ProductService(requestId);
    const result = await service.deleteProduct(parsedId, String(user.id), permanent);

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
      "Failed to delete product"
    );
  }
});

export { putHandler as PUT, deleteHandler as DELETE };