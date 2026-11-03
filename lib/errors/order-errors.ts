import { AppError, ErrorCode } from "@/lib/errors/types";

export enum OrderErrorCode {
  // Authorization errors (10000-10099)
  UNAUTHORIZED_ACCESS = "ORDER_10000",
  SUPERADMIN_REQUIRED = "ORDER_10001",

  // Order domain errors (10100-10199)
  ORDER_NOT_FOUND = "ORDER_10100",
  ORDER_STATUS_TRANSITION_INVALID = "ORDER_10101",
  ORDER_ALREADY_IN_STATUS = "ORDER_10102",
  ORDER_FINALIZED = "ORDER_10103",

  // Validation & filter errors (10200-10299)
  INVALID_ORDER_ID = "ORDER_10200",
  INVALID_STATUS = "ORDER_10201",
  INVALID_DATE_RANGE = "ORDER_10202",
  INVALID_PAGINATION = "ORDER_10203",
  INVALID_FILTER = "ORDER_10204",
  INVALID_REQUEST_BODY = "ORDER_10205",

  // Export & stream errors (10300-10399)
  EXPORT_GENERATION_FAILED = "ORDER_10300",
  EXPORT_TOO_LARGE = "ORDER_10301",
  STREAM_SUBSCRIPTION_FAILED = "ORDER_10302",

  // Audit/cache errors (10400-10499)
  AUDIT_LOG_WRITE_FAILED = "ORDER_10400",
  STATUS_CACHE_WRITE_FAILED = "ORDER_10401",

  // Rate limit & system errors (10500-10599)
  RATE_LIMIT_EXCEEDED = "ORDER_10500",
  INTERNAL_ERROR = "ORDER_10501",
}

export interface OrderErrorResponse {
  success: false;
  error: {
    code: OrderErrorCode;
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

export function toOrderErrorCode(code: OrderErrorCode): ErrorCode {
  return code as unknown as ErrorCode;
}

export function createOrderError(
  code: OrderErrorCode,
  message: string,
  statusCode: number,
  requestId: string,
  details?: Record<string, unknown>
): AppError {
  return new AppError(toOrderErrorCode(code), message, statusCode, details, requestId);
}

export function toOrderErrorResponse(
  code: OrderErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
  responseTime?: number
): OrderErrorResponse {
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

export function extractOrderErrorCode(error: AppError): OrderErrorCode | null {
  const value = String(error.code);
  if (value.startsWith("ORDER_")) {
    return value as OrderErrorCode;
  }
  return null;
}
