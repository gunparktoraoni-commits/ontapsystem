import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors/types";
import {
  AffiliateMgmtErrorCode,
  extractAffiliateMgmtErrorCode,
  toAffiliateMgmtErrorResponse,
} from "@/lib/errors/affiliate-mgmt-errors";

function mapStatusToAffiliateMgmtCode(status: number): AffiliateMgmtErrorCode {
  if (status === 401) return AffiliateMgmtErrorCode.UNAUTHORIZED_ACCESS;
  if (status === 403) return AffiliateMgmtErrorCode.SUPERADMIN_REQUIRED;
  if (status === 404) return AffiliateMgmtErrorCode.AFFILIATE_NOT_FOUND;
  if (status === 409) return AffiliateMgmtErrorCode.AFFILIATE_NOT_RESTRICTED;
  if (status === 413) return AffiliateMgmtErrorCode.EXPORT_TOO_LARGE;
  if (status === 429) return AffiliateMgmtErrorCode.RATE_LIMIT_EXCEEDED;
  if (status === 400 || status === 422) return AffiliateMgmtErrorCode.INVALID_DATE_RANGE;
  return AffiliateMgmtErrorCode.EXPORT_GENERATION_FAILED;
}

export function toAffiliateMgmtErrorNextResponse(
  error: unknown,
  requestId: string,
  responseTime: number,
  fallbackMessage: string
): NextResponse {
  if (error instanceof AppError) {
    const code = extractAffiliateMgmtErrorCode(error) ?? mapStatusToAffiliateMgmtCode(error.statusCode);
    return NextResponse.json(
      toAffiliateMgmtErrorResponse(
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
    toAffiliateMgmtErrorResponse(
      AffiliateMgmtErrorCode.EXPORT_GENERATION_FAILED,
      fallbackMessage,
      requestId,
      undefined,
      responseTime
    ),
    { status: 500 }
  );
}
