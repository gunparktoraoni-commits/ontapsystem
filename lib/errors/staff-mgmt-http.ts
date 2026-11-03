import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors/types";
import {
  StaffMgmtErrorCode,
  extractStaffMgmtErrorCode,
  toStaffMgmtErrorResponse,
} from "@/lib/errors/staff-mgmt-errors";

function mapStatusToStaffMgmtCode(status: number): StaffMgmtErrorCode {
  if (status === 400 || status === 422) return StaffMgmtErrorCode.INVALID_FILTER_TYPE;
  if (status === 401) return StaffMgmtErrorCode.UNAUTHORIZED_ACCESS;
  if (status === 403) return StaffMgmtErrorCode.SUPERADMIN_REQUIRED;
  if (status === 404) return StaffMgmtErrorCode.STAFF_NOT_FOUND;
  if (status === 409) return StaffMgmtErrorCode.STAFF_ALREADY_EXISTS;
  if (status === 413) return StaffMgmtErrorCode.EXPORT_TOO_LARGE;
  if (status === 429) return StaffMgmtErrorCode.RATE_LIMIT_EXCEEDED;
  return StaffMgmtErrorCode.INTERNAL_ERROR;
}

export function toStaffMgmtErrorNextResponse(
  error: unknown,
  requestId: string,
  responseTime: number,
  fallbackMessage: string
): NextResponse {
  if (error instanceof AppError) {
    const code = extractStaffMgmtErrorCode(error) ?? mapStatusToStaffMgmtCode(error.statusCode);
    return NextResponse.json(
      toStaffMgmtErrorResponse(
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
    toStaffMgmtErrorResponse(
      StaffMgmtErrorCode.INTERNAL_ERROR,
      fallbackMessage,
      requestId,
      undefined,
      responseTime
    ),
    { status: 500 }
  );
}
