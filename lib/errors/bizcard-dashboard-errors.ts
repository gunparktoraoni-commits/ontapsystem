import { AppError, ErrorCode } from "@/lib/errors/types";

export enum BizcardDashboardErrorCode {
  RATE_LIMIT_EXCEEDED = "BIZCARD_DASH_37999",
  UNAUTHORIZED = "BIZCARD_DASH_38000",
  BIZCARD_NOT_FOUND = "BIZCARD_DASH_38001",
  BIZCARD_ACCESS_DENIED = "BIZCARD_DASH_38002",
  INVALID_DATE_RANGE = "BIZCARD_DASH_38003",
  NO_BIZCARDS_FOUND = "BIZCARD_DASH_38004",
  INVALID_FILTER = "BIZCARD_DASH_38005",
}

export function toBizcardDashboardErrorCode(code: BizcardDashboardErrorCode): ErrorCode {
  return code as unknown as ErrorCode;
}

export function createBizcardDashboardError(
  code: BizcardDashboardErrorCode,
  message: string,
  statusCode: number,
  requestId: string,
  details?: Record<string, unknown>
): AppError {
  return new AppError(toBizcardDashboardErrorCode(code), message, statusCode, details, requestId);
}

export function toBizcardDashboardErrorResponse(
  code: BizcardDashboardErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
  responseTime?: number
): {
  success: false;
  error: {
    code: BizcardDashboardErrorCode;
    message: string;
    details?: Record<string, unknown>;
    requestId: string;
    timestamp: string;
  };
  meta: {
    requestId: string;
    responseTime?: number;
  };
} {
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
