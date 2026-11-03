import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors/types";
import {
  SuperAdminErrorCode,
  extractSuperAdminErrorCode,
  toSuperAdminErrorResponse,
} from "@/lib/errors/superadmin-errors";

function mapStatusToSuperAdminCode(status: number): SuperAdminErrorCode {
  if (status === 401) return SuperAdminErrorCode.UNAUTHORIZED_ACCESS;
  if (status === 403) return SuperAdminErrorCode.SUPERADMIN_REQUIRED;
  if (status === 404) return SuperAdminErrorCode.IMPERSONATION_TARGET_NOT_FOUND;
  if (status === 409) return SuperAdminErrorCode.IMPERSONATION_NOT_ALLOWED;
  if (status === 429) return SuperAdminErrorCode.RATE_LIMIT_EXCEEDED;
  if (status === 422) return SuperAdminErrorCode.INVALID_PAGINATION;
  if (status === 400) return SuperAdminErrorCode.INVALID_DATE_FILTER;
  return SuperAdminErrorCode.INTERNAL_ERROR;
}

export function toSuperAdminErrorNextResponse(
  error: unknown,
  requestId: string,
  responseTime: number,
  fallbackMessage: string
): NextResponse {
  if (error instanceof AppError) {
    const code = extractSuperAdminErrorCode(error) ?? mapStatusToSuperAdminCode(error.statusCode);
    return NextResponse.json(
      toSuperAdminErrorResponse(
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
    toSuperAdminErrorResponse(
      SuperAdminErrorCode.INTERNAL_ERROR,
      fallbackMessage,
      requestId,
      undefined,
      responseTime
    ),
    { status: 500 }
  );
}
