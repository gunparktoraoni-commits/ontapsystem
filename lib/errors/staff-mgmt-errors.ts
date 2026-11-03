import { AppError, ErrorCode } from "@/lib/errors/types";

export enum StaffMgmtErrorCode {
  // Authorization errors (16000-16099)
  UNAUTHORIZED_ACCESS = "STAFF_MGMT_16000",
  SUPERADMIN_REQUIRED = "STAFF_MGMT_16001",
  INSUFFICIENT_PERMISSIONS = "STAFF_MGMT_16002",

  // Staff errors (16100-16199)
  STAFF_NOT_FOUND = "STAFF_MGMT_16100",
  STAFF_ALREADY_EXISTS = "STAFF_MGMT_16101",
  INVALID_ROLE = "STAFF_MGMT_16102",
  INVALID_DEPARTMENT = "STAFF_MGMT_16103",
  STAFF_EMAIL_EXISTS = "STAFF_MGMT_16104",

  // Permission errors (16200-16299)
  PERMISSION_NOT_FOUND = "STAFF_MGMT_16200",
  INVALID_PERMISSION_CONFIG = "STAFF_MGMT_16201",
  PERMISSION_UPDATE_FAILED = "STAFF_MGMT_16202",

  // Export errors (16300-16399)
  EXPORT_GENERATION_FAILED = "STAFF_MGMT_16300",
  EXPORT_TOO_LARGE = "STAFF_MGMT_16301",

  // Date/Filter errors (16400-16499)
  INVALID_DATE_RANGE = "STAFF_MGMT_16400",
  INVALID_FILTER_TYPE = "STAFF_MGMT_16401",

  // Rate limiting (16500-16599)
  RATE_LIMIT_EXCEEDED = "STAFF_MGMT_16500",
  INTERNAL_ERROR = "STAFF_MGMT_16501",
}

export interface StaffMgmtErrorResponse {
  success: false;
  error: {
    code: StaffMgmtErrorCode;
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

export function toStaffMgmtErrorCode(code: StaffMgmtErrorCode): ErrorCode {
  return code as unknown as ErrorCode;
}

export function createStaffMgmtError(
  code: StaffMgmtErrorCode,
  message: string,
  statusCode: number,
  requestId: string,
  details?: Record<string, unknown>
): AppError {
  return new AppError(toStaffMgmtErrorCode(code), message, statusCode, details, requestId);
}

export function toStaffMgmtErrorResponse(
  code: StaffMgmtErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
  responseTime?: number
): StaffMgmtErrorResponse {
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

export function extractStaffMgmtErrorCode(error: AppError): StaffMgmtErrorCode | null {
  const value = String(error.code);
  if (value.startsWith("STAFF_MGMT_")) {
    return value as StaffMgmtErrorCode;
  }
  return null;
}
