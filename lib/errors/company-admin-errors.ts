import { AppError, ErrorCode } from "@/lib/errors/types";

export enum CompanyAdminErrorCode {
  NOT_FOUND = "COMPANY_ADMIN_30000",
  INVALID_REQUEST = "COMPANY_ADMIN_30001",
  PERMISSION_DENIED = "COMPANY_ADMIN_30002",
  RATE_LIMIT_EXCEEDED = "COMPANY_ADMIN_30003",
  INVITE_FAILED = "COMPANY_ADMIN_30004",
  JOIN_REQUEST_NOT_FOUND = "COMPANY_ADMIN_30005",
  JOIN_REQUEST_ALREADY_PROCESSED = "COMPANY_ADMIN_30006",
  COMPANY_LIMIT_REACHED = "COMPANY_ADMIN_30007",
  EMPLOYEE_ALREADY_MEMBER = "COMPANY_ADMIN_30008",
  SERIAL_ID_INVALID = "COMPANY_ADMIN_30009",
  EMAIL_INVITE_QUEUED = "COMPANY_ADMIN_30010",
}

export function toCompanyAdminErrorCode(code: CompanyAdminErrorCode): ErrorCode {
  return code as unknown as ErrorCode;
}

export function createCompanyAdminError(
  code: CompanyAdminErrorCode,
  message: string,
  statusCode: number,
  requestId?: string,
  details?: Record<string, unknown>
): AppError {
  return new AppError(toCompanyAdminErrorCode(code), message, statusCode, details, requestId);
}
