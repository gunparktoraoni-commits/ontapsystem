import { AppError, ErrorCode } from "@/lib/errors/types";

export enum StaffMarketingErrorCode {
  STAFF_ROLE_REQUIRED = "STAFF_MARKETING_2000",
  STAFF_PROFILE_NOT_FOUND = "STAFF_MARKETING_2001",
  MARKETING_DESIGNATION_REQUIRED = "STAFF_MARKETING_2002",
  RATE_LIMIT_EXCEEDED = "STAFF_MARKETING_2003",
  EXPORT_GENERATION_FAILED = "STAFF_MARKETING_2004",
  INTERNAL_ERROR = "STAFF_MARKETING_2005",
  INVALID_FILTER_TYPE = "STAFF_MARKETING_2006",
  INQUIRY_NOT_FOUND = "STAFF_MARKETING_2007",
  INQUIRY_NOT_ASSIGNED_TO_STAFF = "STAFF_MARKETING_2008",
  CLIENT_NOT_ASSIGNED = "STAFF_MARKETING_2009",
}

export interface StaffMarketingErrorResponse {
  success: false;
  error: {
    code: StaffMarketingErrorCode;
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

export function toStaffMarketingErrorCode(code: StaffMarketingErrorCode): ErrorCode {
  return code as unknown as ErrorCode;
}

export function createStaffMarketingError(
  code: StaffMarketingErrorCode,
  message: string,
  statusCode: number,
  requestId?: string,
  details?: Record<string, unknown>
): AppError {
  return new AppError(toStaffMarketingErrorCode(code), message, statusCode, details, requestId);
}

export function toStaffMarketingErrorResponse(
  code: StaffMarketingErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
  responseTime?: number
): StaffMarketingErrorResponse {
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

export function extractStaffMarketingErrorCode(error: AppError): StaffMarketingErrorCode | null {
  const value = String(error.code);
  if (value.startsWith("STAFF_MARKETING_")) {
    return value as StaffMarketingErrorCode;
  }
  return null;
}
