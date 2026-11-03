import { AppError, ErrorCode } from "@/lib/errors/types";

export enum CompanyErrorCode {
  COMPANY_NOT_FOUND = "COMPANY_3000",
  COMPANY_ALREADY_EXISTS = "COMPANY_3001",
  COMPANY_PENDING_APPROVAL = "COMPANY_3002",
  COMPANY_SUSPENDED = "COMPANY_3003",
  COMPANY_REJECTED = "COMPANY_3004",
  COMPANY_NAME_CHANGE_PENDING = "COMPANY_3005",
  COMPANY_NAME_CHANGE_COOLDOWN = "COMPANY_3006",
  RATE_LIMIT_EXCEEDED = "COMPANY_3007",
  INVALID_COMPANY_THEME = "COMPANY_3008",
  ADMIN_TRANSFER_FAILED = "COMPANY_3009",
  COMPANY_THEME_MANAGED = "COMPANY_3010",

  SUBSCRIPTION_REQUIRED = "SUBSCRIPTION_3100",
  EMPLOYEE_LIMIT_REACHED = "SUBSCRIPTION_3101",
  INVALID_SUBSCRIPTION_TIER = "SUBSCRIPTION_3102",

  EMPLOYEE_NOT_FOUND = "EMPLOYEE_3200",
  EMPLOYEE_ALREADY_IN_COMPANY = "EMPLOYEE_3201",
  EMPLOYEE_IN_ANOTHER_COMPANY = "EMPLOYEE_3202",
  EMPLOYEE_RESTRICTED = "EMPLOYEE_3203",
  INSUFFICIENT_PERMISSIONS = "EMPLOYEE_3204",
  CANNOT_REMOVE_LAST_ADMIN = "EMPLOYEE_3205",
  INVALID_EMPLOYEE_DATA = "EMPLOYEE_3206",
  CO_ADMIN_LIMIT_REACHED = "EMPLOYEE_3207",

  JOIN_REQUEST_NOT_FOUND = "JOIN_3300",
  JOIN_REQUEST_PENDING = "JOIN_3301",
  JOIN_REQUEST_ALREADY_PROCESSED = "JOIN_3302",
  INVALID_SECURITY_CODE = "JOIN_3303",
  COMPANY_JOIN_DISABLED = "JOIN_3304",

  UNAUTHORIZED_COMPANY_ACTION = "AUTH_3400",
  ADMIN_REQUIRED = "AUTH_3401",
  SUPER_ADMIN_REQUIRED = "AUTH_3402",

  ANALYTICS_NOT_FOUND = "ANALYTICS_3500",
  INVALID_PERIOD = "ANALYTICS_3501",
}

export function toCompanyErrorCode(code: CompanyErrorCode): ErrorCode {
  return code as unknown as ErrorCode;
}

export function createCompanyError(
  code: CompanyErrorCode,
  message: string,
  statusCode: number,
  requestId?: string,
  details?: Record<string, unknown>
): AppError {
  return new AppError(toCompanyErrorCode(code), message, statusCode, details, requestId);
}

export interface CompanyErrorResponse {
  success: false;
  error: {
    code: CompanyErrorCode;
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

export function toCompanyErrorResponse(
  code: CompanyErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
  responseTime?: number
): CompanyErrorResponse {
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

export function extractCompanyErrorCode(error: AppError): CompanyErrorCode | null {
  const value = String(error.code);
  if (value.startsWith("COMPANY_")) {
    return value as CompanyErrorCode;
  }
  return null;
}
