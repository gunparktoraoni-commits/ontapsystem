import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors/types";
import {
  AffiliateErrorCode,
  extractAffiliateErrorCode,
  toAffiliateErrorResponse,
} from "@/lib/errors/affiliate-errors";

function mapStatusToAffiliateCode(status: number): AffiliateErrorCode {
  if (status === 401) return AffiliateErrorCode.UNAUTHORIZED_ACCESS;
  if (status === 403) return AffiliateErrorCode.SUPERADMIN_REQUIRED;
  if (status === 404) return AffiliateErrorCode.AFFILIATE_NOT_FOUND;
  if (status === 409) return AffiliateErrorCode.AFFILIATE_NOT_RESTRICTED;
  if (status === 413) return AffiliateErrorCode.EXPORT_TOO_LARGE;
  if (status === 429) return AffiliateErrorCode.RATE_LIMIT_EXCEEDED;
  if (status === 400 || status === 422) return AffiliateErrorCode.INVALID_DATE_RANGE;
  return AffiliateErrorCode.EXPORT_GENERATION_FAILED;
}

export function toAffiliateErrorNextResponse(
  error: unknown,
  requestId: string,
  responseTime: number,
  fallbackMessage: string
): NextResponse {
  if (error instanceof AppError) {
    const code = extractAffiliateErrorCode(error) ?? mapStatusToAffiliateCode(error.statusCode);
    return NextResponse.json(
      toAffiliateErrorResponse(
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
    toAffiliateErrorResponse(
      AffiliateErrorCode.EXPORT_GENERATION_FAILED,
      fallbackMessage,
      requestId,
      undefined,
      responseTime
    ),
    { status: 500 }
  );
}
