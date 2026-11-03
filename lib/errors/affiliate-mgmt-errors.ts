import { AppError, ErrorCode } from "@/lib/errors/types";

export enum AffiliateMgmtErrorCode {
  // Authorization errors (14000-14099)
  UNAUTHORIZED_ACCESS = "AFFILIATE_MGMT_14000",
  SUPERADMIN_REQUIRED = "AFFILIATE_MGMT_14001",

  // Affiliate errors (14100-14199)
  AFFILIATE_NOT_FOUND = "AFFILIATE_MGMT_14100",
  AFFILIATE_ALREADY_RESTRICTED = "AFFILIATE_MGMT_14101",
  AFFILIATE_NOT_RESTRICTED = "AFFILIATE_MGMT_14102",
  INVALID_COMMISSION_RATE = "AFFILIATE_MGMT_14103",
  INVALID_AFFILIATE_DATA = "AFFILIATE_MGMT_14104",

  // Update errors (14200-14299)
  UPDATE_FAILED = "AFFILIATE_MGMT_14200",

  // Export errors (14300-14399)
  EXPORT_GENERATION_FAILED = "AFFILIATE_MGMT_14300",
  EXPORT_TOO_LARGE = "AFFILIATE_MGMT_14301",

  // Date/Filter errors (14400-14499)
  INVALID_DATE_RANGE = "AFFILIATE_MGMT_14400",

  // Rate limiting (14500-14599)
  RATE_LIMIT_EXCEEDED = "AFFILIATE_MGMT_14500",
}

export interface AffiliateMgmtErrorResponse {
  success: false;
  error: {
    code: AffiliateMgmtErrorCode;
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

export function toAffiliateMgmtErrorCode(code: AffiliateMgmtErrorCode): ErrorCode {
  return code as unknown as ErrorCode;
}

export function createAffiliateMgmtError(
  code: AffiliateMgmtErrorCode,
  message: string,
  statusCode: number,
  requestId: string,
  details?: Record<string, unknown>
): AppError {
  return new AppError(toAffiliateMgmtErrorCode(code), message, statusCode, details, requestId);
}

export function toAffiliateMgmtErrorResponse(
  code: AffiliateMgmtErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
  responseTime?: number
): AffiliateMgmtErrorResponse {
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

export function extractAffiliateMgmtErrorCode(error: AppError): AffiliateMgmtErrorCode | null {
  const value = String(error.code);
  if (value.startsWith("AFFILIATE_MGMT_")) {
    return value as AffiliateMgmtErrorCode;
  }
  return null;
}
