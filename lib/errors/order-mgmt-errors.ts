import { AppError, ErrorCode } from "@/lib/errors/types";
import { OrderErrorCode } from "@/lib/errors/order-errors";

export enum OrderMgmtErrorCode {
  // Authorization errors (15000-15099)
  UNAUTHORIZED_ACCESS = "ORDER_MGMT_15000",
  SUPERADMIN_REQUIRED = "ORDER_MGMT_15001",

  // Order domain errors (15100-15199)
  ORDER_NOT_FOUND = "ORDER_MGMT_15100",
  ORDER_STATUS_TRANSITION_INVALID = "ORDER_MGMT_15101",
  ORDER_ALREADY_IN_STATUS = "ORDER_MGMT_15102",
  ORDER_FINALIZED = "ORDER_MGMT_15103",

  // Validation & filter errors (15200-15299)
  INVALID_ORDER_ID = "ORDER_MGMT_15200",
  INVALID_STATUS = "ORDER_MGMT_15201",
  INVALID_DATE_RANGE = "ORDER_MGMT_15202",
  INVALID_PAGINATION = "ORDER_MGMT_15203",
  INVALID_FILTER = "ORDER_MGMT_15204",
  INVALID_REQUEST_BODY = "ORDER_MGMT_15205",

  // Export/report errors (15300-15399)
  EXPORT_GENERATION_FAILED = "ORDER_MGMT_15300",
  EXPORT_TOO_LARGE = "ORDER_MGMT_15301",
  STREAM_SUBSCRIPTION_FAILED = "ORDER_MGMT_15302",
  PDF_REPORT_GENERATION_FAILED = "ORDER_MGMT_15303",
  PDF_REPORT_TOO_LARGE = "ORDER_MGMT_15304",

  // Audit/cache errors (15400-15499)
  AUDIT_LOG_WRITE_FAILED = "ORDER_MGMT_15400",
  STATUS_CACHE_WRITE_FAILED = "ORDER_MGMT_15401",

  // Rate limit & system errors (15500-15599)
  RATE_LIMIT_EXCEEDED = "ORDER_MGMT_15500",
  INTERNAL_ERROR = "ORDER_MGMT_15501",
}

const ORDER_TO_ORDER_MGMT_CODE: Record<OrderErrorCode, OrderMgmtErrorCode> = {
  [OrderErrorCode.UNAUTHORIZED_ACCESS]: OrderMgmtErrorCode.UNAUTHORIZED_ACCESS,
  [OrderErrorCode.SUPERADMIN_REQUIRED]: OrderMgmtErrorCode.SUPERADMIN_REQUIRED,
  [OrderErrorCode.ORDER_NOT_FOUND]: OrderMgmtErrorCode.ORDER_NOT_FOUND,
  [OrderErrorCode.ORDER_STATUS_TRANSITION_INVALID]:
    OrderMgmtErrorCode.ORDER_STATUS_TRANSITION_INVALID,
  [OrderErrorCode.ORDER_ALREADY_IN_STATUS]: OrderMgmtErrorCode.ORDER_ALREADY_IN_STATUS,
  [OrderErrorCode.ORDER_FINALIZED]: OrderMgmtErrorCode.ORDER_FINALIZED,
  [OrderErrorCode.INVALID_ORDER_ID]: OrderMgmtErrorCode.INVALID_ORDER_ID,
  [OrderErrorCode.INVALID_STATUS]: OrderMgmtErrorCode.INVALID_STATUS,
  [OrderErrorCode.INVALID_DATE_RANGE]: OrderMgmtErrorCode.INVALID_DATE_RANGE,
  [OrderErrorCode.INVALID_PAGINATION]: OrderMgmtErrorCode.INVALID_PAGINATION,
  [OrderErrorCode.INVALID_FILTER]: OrderMgmtErrorCode.INVALID_FILTER,
  [OrderErrorCode.INVALID_REQUEST_BODY]: OrderMgmtErrorCode.INVALID_REQUEST_BODY,
  [OrderErrorCode.EXPORT_GENERATION_FAILED]: OrderMgmtErrorCode.EXPORT_GENERATION_FAILED,
  [OrderErrorCode.EXPORT_TOO_LARGE]: OrderMgmtErrorCode.EXPORT_TOO_LARGE,
  [OrderErrorCode.STREAM_SUBSCRIPTION_FAILED]: OrderMgmtErrorCode.STREAM_SUBSCRIPTION_FAILED,
  [OrderErrorCode.AUDIT_LOG_WRITE_FAILED]: OrderMgmtErrorCode.AUDIT_LOG_WRITE_FAILED,
  [OrderErrorCode.STATUS_CACHE_WRITE_FAILED]: OrderMgmtErrorCode.STATUS_CACHE_WRITE_FAILED,
  [OrderErrorCode.RATE_LIMIT_EXCEEDED]: OrderMgmtErrorCode.RATE_LIMIT_EXCEEDED,
  [OrderErrorCode.INTERNAL_ERROR]: OrderMgmtErrorCode.INTERNAL_ERROR,
};

const ORDER_MGMT_ERROR_CODES = new Set<string>(Object.values(OrderMgmtErrorCode));
const ORDER_ERROR_CODES = new Set<string>(Object.values(OrderErrorCode));

export interface OrderMgmtErrorResponse {
  success: false;
  error: {
    code: OrderMgmtErrorCode;
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

export function toOrderMgmtErrorCode(code: OrderMgmtErrorCode): ErrorCode {
  return code as unknown as ErrorCode;
}

export function toOrderMgmtFromOrderCode(code: OrderErrorCode): OrderMgmtErrorCode {
  return ORDER_TO_ORDER_MGMT_CODE[code];
}

export function createOrderMgmtError(
  code: OrderMgmtErrorCode,
  message: string,
  statusCode: number,
  requestId: string,
  details?: Record<string, unknown>
): AppError {
  return new AppError(toOrderMgmtErrorCode(code), message, statusCode, details, requestId);
}

export function toOrderMgmtErrorResponse(
  code: OrderMgmtErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
  responseTime?: number
): OrderMgmtErrorResponse {
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

export function extractOrderMgmtErrorCode(error: AppError): OrderMgmtErrorCode | null {
  const value = String(error.code);

  if (ORDER_MGMT_ERROR_CODES.has(value)) {
    return value as OrderMgmtErrorCode;
  }

  if (ORDER_ERROR_CODES.has(value)) {
    return toOrderMgmtFromOrderCode(value as OrderErrorCode);
  }

  return null;
}
