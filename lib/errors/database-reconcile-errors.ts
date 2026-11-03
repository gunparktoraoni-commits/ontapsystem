import { AppError, ErrorCode } from "@/lib/errors/types";

export enum DatabaseReconcileErrorCode {
  // File errors (22000-22099)
  INVALID_SQL_FILE = "RECONCILE_22000",
  SQL_FILE_TOO_LARGE = "RECONCILE_22001",
  SQL_PARSE_FAILED = "RECONCILE_22002",

  // Data errors (22100-22199)
  USER_NOT_FOUND = "RECONCILE_22100",
  COMPANY_CREATION_FAILED = "RECONCILE_22101",
  USER_UPDATE_FAILED = "RECONCILE_22102",
  REFERENTIAL_INTEGRITY_ERROR = "RECONCILE_22103",
  SOURCE_DATA_UNAVAILABLE = "RECONCILE_22104",

  // Transaction errors (22200-22299)
  TRANSACTION_FAILED = "RECONCILE_22200",
  ROLLBACK_EXECUTED = "RECONCILE_22201",

  // Rate limiting (22300-22399)
  RATE_LIMIT_EXCEEDED = "RECONCILE_22300",

  // System (22500+)
  INTERNAL_ERROR = "RECONCILE_22500",
}

export interface DatabaseReconcileErrorResponse {
  success: false;
  error: {
    code: DatabaseReconcileErrorCode;
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

export function toDatabaseReconcileErrorCode(code: DatabaseReconcileErrorCode): ErrorCode {
  return code as unknown as ErrorCode;
}

export function createDatabaseReconcileError(
  code: DatabaseReconcileErrorCode,
  message: string,
  statusCode: number,
  requestId: string,
  details?: Record<string, unknown>
): AppError {
  return new AppError(toDatabaseReconcileErrorCode(code), message, statusCode, details, requestId);
}

export function toDatabaseReconcileErrorResponse(
  code: DatabaseReconcileErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
  responseTime?: number
): DatabaseReconcileErrorResponse {
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

export function extractDatabaseReconcileErrorCode(
  error: AppError
): DatabaseReconcileErrorCode | null {
  const value = String(error.code);
  if (value.startsWith("RECONCILE_")) {
    return value as DatabaseReconcileErrorCode;
  }
  return null;
}
