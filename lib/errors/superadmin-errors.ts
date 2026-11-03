import { AppError, ErrorCode } from "@/lib/errors/types";

export enum SuperAdminErrorCode {
  // Authorization errors (11000-11099)
  UNAUTHORIZED_ACCESS = "SUPERADMIN_11000",
  SUPERADMIN_REQUIRED = "SUPERADMIN_11001",

  // Dashboard and domain retrieval errors (11100-11199)
  DASHBOARD_METRICS_FAILED = "SUPERADMIN_11100",
  RECENT_ACTIVITIES_FAILED = "SUPERADMIN_11101",
  USERS_LIST_FAILED = "SUPERADMIN_11102",
  SYSTEM_HEALTH_FAILED = "SUPERADMIN_11103",
  STAFF_ACTIVITIES_FAILED = "SUPERADMIN_11104",
  RECENT_ORDERS_FAILED = "SUPERADMIN_11105",

  // Validation and query errors (11200-11299)
  INVALID_DATE_FILTER = "SUPERADMIN_11200",
  INVALID_DATE_RANGE = "SUPERADMIN_11201",
  INVALID_TIMEZONE = "SUPERADMIN_11202",
  INVALID_PAGINATION = "SUPERADMIN_11203",
  INVALID_STATUS_FILTER = "SUPERADMIN_11204",
  INVALID_SORT_FIELD = "SUPERADMIN_11205",
  INVALID_FILTER = "SUPERADMIN_11206",

  // Impersonation errors (11400-11499)
  IMPERSONATION_INVALID_TOKEN = "SUPERADMIN_11400",
  IMPERSONATION_EXPIRED = "SUPERADMIN_11401",
  IMPERSONATION_REVOKED = "SUPERADMIN_11402",
  IMPERSONATION_TARGET_NOT_FOUND = "SUPERADMIN_11403",
  IMPERSONATION_NOT_ALLOWED = "SUPERADMIN_11404",
  IMPERSONATION_START_FAILED = "SUPERADMIN_11405",
  IMPERSONATION_END_FAILED = "SUPERADMIN_11406",

  // Company management errors (11700-11799)
  COMPANY_ALREADY_RESTRICTED = "SUPERADMIN_11700",
  COMPANY_RESTRICT_FAILED = "SUPERADMIN_11701",

  // Rate limit and system errors (11300-11599)
  RATE_LIMIT_EXCEEDED = "SUPERADMIN_11300",
  INTERNAL_ERROR = "SUPERADMIN_11500",

  // Bizcard errors (11600-11699)
  BIZCARD_NOT_FOUND = "SUPERADMIN_11600",
  BIZCARD_INVALID_DATA = "SUPERADMIN_11601",
  BIZCARD_CREATION_FAILED = "SUPERADMIN_11602",
  BIZCARD_UPDATE_FAILED = "SUPERADMIN_11603",
  BIZCARD_DELETE_FAILED = "SUPERADMIN_11604",
  BIZCARD_EXPORT_FAILED = "SUPERADMIN_11605",
  BIZCARD_SERIAL_INVALID = "SUPERADMIN_11606",
  BIZCARD_ACCESS_DENIED = "SUPERADMIN_11607",
  BIZCARD_DETAIL_FAILED = "SUPERADMIN_11608",
  BIZCARD_MARK_DISTRIBUTED_FAILED = "SUPERADMIN_11609",
  BIZCARD_ALREADY_CLAIMED = "SUPERADMIN_11610",
  BIZCARD_MARK_DISTRIBUTED_ALL_FAILED = "SUPERADMIN_11611",
}

export interface SuperAdminErrorResponse {
  success: false;
  error: {
    code: SuperAdminErrorCode;
    message: string;
    details?: Record<string, unknown>;
    requestId: string;
    timestamp: string;
  };
  meta?: {
    requestId: string;
    responseTime?: number;
  };
}

export function toSuperAdminErrorCode(code: SuperAdminErrorCode): ErrorCode {
  return code as unknown as ErrorCode;
}

export function createSuperAdminError(
  code: SuperAdminErrorCode,
  message: string,
  statusCode: number,
  requestId: string,
  details?: Record<string, unknown>
): AppError {
  return new AppError(toSuperAdminErrorCode(code), message, statusCode, details, requestId);
}

export function toSuperAdminErrorResponse(
  code: SuperAdminErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
  responseTime?: number
): SuperAdminErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      details,
      requestId,
      timestamp: new Date().toISOString(),
    },
    meta: {
      requestId,
      ...(responseTime !== undefined ? { responseTime } : {}),
    },
  };
}

export function extractSuperAdminErrorCode(error: AppError): SuperAdminErrorCode | null {
  const value = String(error.code);
  if (value.startsWith("SUPERADMIN_")) {
    return value as SuperAdminErrorCode;
  }
  return null;
}
