import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors/types";
import {
  extractProductPromoErrorCode,
  ProductPromoErrorCode,
  toProductPromoErrorResponse,
} from "@/lib/errors/product-promo-errors";

function mapStatusToProductPromoCode(status: number): ProductPromoErrorCode {
  if (status === 400 || status === 422) return ProductPromoErrorCode.INVALID_DATE_RANGE;
  if (status === 401) return ProductPromoErrorCode.UNAUTHORIZED_ACCESS;
  if (status === 403) return ProductPromoErrorCode.SUPERADMIN_REQUIRED;
  if (status === 404) return ProductPromoErrorCode.PRODUCT_NOT_FOUND;
  if (status === 409) return ProductPromoErrorCode.PRODUCT_NAME_EXISTS;
  if (status === 429) return ProductPromoErrorCode.RATE_LIMIT_EXCEEDED;
  return ProductPromoErrorCode.INTERNAL_ERROR;
}

export function toProductPromoErrorNextResponse(
  error: unknown,
  requestId: string,
  responseTime: number,
  fallbackMessage: string
): NextResponse {
  if (error instanceof AppError) {
    const code = extractProductPromoErrorCode(error) ?? mapStatusToProductPromoCode(error.statusCode);
    return NextResponse.json(
      toProductPromoErrorResponse(
        code,
        error.message,
        error.requestId ?? requestId,
        error.details,
        responseTime
      ),
      { status: error.statusCode }
    );
  }

  return NextResponse.json(
    toProductPromoErrorResponse(
      ProductPromoErrorCode.INTERNAL_ERROR,
      fallbackMessage,
      requestId,
      undefined,
      responseTime
    ),
    { status: 500 }
  );
}
