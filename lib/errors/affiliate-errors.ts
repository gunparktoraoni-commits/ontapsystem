import { AppError, ErrorCode } from "@/lib/errors/types";

export enum AffiliateErrorCode {
  // Authorization errors (9000-9099)
  UNAUTHORIZED_ACCESS = "AFFILIATE_9000",
  SUPERADMIN_REQUIRED = "AFFILIATE_9001",

  // Affiliate errors (9100-9199)
  AFFILIATE_NOT_FOUND = "AFFILIATE_9100",
  AFFILIATE_ALREADY_EXISTS = "AFFILIATE_9101",
  AFFILIATE_ALREADY_RESTRICTED = "AFFILIATE_9102",
  AFFILIATE_NOT_RESTRICTED = "AFFILIATE_9103",
  INVALID_COMMISSION_RATE = "AFFILIATE_9104",

  // Referral errors (9200-9299)
  REFERRAL_NOT_FOUND = "AFFILIATE_9200",
  INVALID_REFERRAL_DATA = "AFFILIATE_9201",

  // Export errors (9300-9399)
  EXPORT_GENERATION_FAILED = "AFFILIATE_9300",
  EXPORT_TOO_LARGE = "AFFILIATE_9301",

  // Date/Filter errors (9400-9499)
  INVALID_DATE_RANGE = "AFFILIATE_9400",
  INVALID_PERIOD = "AFFILIATE_9401",

  // Rate limiting (9500-9599)
  RATE_LIMIT_EXCEEDED = "AFFILIATE_9500",
}

export interface AffiliateErrorResponse {
  success: false;
  error: {
    code: AffiliateErrorCode;
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

export function toAffiliateErrorCode(code: AffiliateErrorCode): ErrorCode {
  return code as unknown as ErrorCode;
}

export function createAffiliateError(
  code: AffiliateErrorCode,
  message: string,
  statusCode: number,
  requestId: string,
  details?: Record<string, unknown>
): AppError {
  return new AppError(toAffiliateErrorCode(code), message, statusCode, details, requestId);
}

export function toAffiliateErrorResponse(
  code: AffiliateErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
  responseTime?: number
): AffiliateErrorResponse {
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

export function extractAffiliateErrorCode(error: AppError): AffiliateErrorCode | null {
  const value = String(error.code);
  if (value.startsWith("AFFILIATE_")) {
    return value as AffiliateErrorCode;
  }
  return null;
}
