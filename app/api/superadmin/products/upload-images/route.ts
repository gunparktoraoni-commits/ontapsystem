import { NextRequest, NextResponse } from "next/server";
import { type SuperAdminContext, withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { ProductService } from "@/lib/services/product.service";
import { checkProductPromoRateLimit } from "@/lib/rate-limit/product-promo-limits";
import {
  createProductPromoError,
  ProductPromoErrorCode,
  toProductPromoErrorResponse,
} from "@/lib/errors/product-promo-errors";
import { toProductPromoErrorNextResponse } from "@/lib/errors/product-promo-http";

const postHandler = withSuperAdmin(async (req: NextRequest, context: Record<string, unknown> & SuperAdminContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkProductPromoRateLimit(req, "UPLOAD_IMAGES", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toProductPromoErrorResponse(
          ProductPromoErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many image upload requests",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) } }
      );
    }

    const form = await req.formData().catch(() => null);
    if (!form) {
      throw createProductPromoError(
        ProductPromoErrorCode.IMAGE_UPLOAD_FAILED,
        "Invalid multipart/form-data body",
        400,
        requestId
      );
    }

    const productName = String(form.get("productName") ?? "").trim();
    if (productName.length < 2) {
      throw createProductPromoError(
        ProductPromoErrorCode.IMAGE_UPLOAD_FAILED,
        "productName is required",
        400,
        requestId
      );
    }

    const frontImageRaw = form.get("frontImage");
    const backImageRaw = form.get("backImage");
    const mainImageRaw = form.get("mainImage");
    const variableFrontRaw = form.get("variableFrontImage");
    const variableBackRaw = form.get("variableBackImage");
    const galleryRaw = form.getAll("images");

    const files = {
      frontImage: frontImageRaw instanceof File ? frontImageRaw : undefined,
      backImage: backImageRaw instanceof File ? backImageRaw : undefined,
      mainImage: mainImageRaw instanceof File ? mainImageRaw : undefined,
      variableFrontImage: variableFrontRaw instanceof File ? variableFrontRaw : undefined,
      variableBackImage: variableBackRaw instanceof File ? variableBackRaw : undefined,
      images: galleryRaw.filter(
        (entry): entry is File => entry instanceof File && entry.size > 0,
      ),
    };

    if (
      !files.frontImage &&
      !files.backImage &&
      !files.mainImage &&
      !files.variableFrontImage &&
      !files.variableBackImage &&
      files.images.length === 0
    ) {
      throw createProductPromoError(
        ProductPromoErrorCode.IMAGE_UPLOAD_FAILED,
        "At least one image file is required",
        400,
        requestId
      );
    }

    const service = new ProductService(requestId);
    const uploaded = await service.uploadProductImages(files, productName);

    return NextResponse.json({
      success: true,
      data: uploaded,
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
      "Failed to upload product images"
    );
  }
});

export async function POST(req: NextRequest, context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }) {
  return postHandler(req, context);
}
