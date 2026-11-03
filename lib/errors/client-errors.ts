import { AppError, ErrorCode } from "@/lib/errors/types";

export enum ClientErrorCode {
  // Authorization errors (8000-8099)
  UNAUTHORIZED_ACCESS = "CLIENT_8000",
  SUPERADMIN_REQUIRED = "CLIENT_8001",

  // Client errors (8100-8199)
  CLIENT_NOT_FOUND = "CLIENT_8100",
  CLIENT_ALREADY_RESTRICTED = "CLIENT_8101",
  CLIENT_NOT_RESTRICTED = "CLIENT_8102",
  INVALID_RESTRICTION_DURATION = "CLIENT_8103",

  // Export errors (8200-8299)
  EXPORT_GENERATION_FAILED = "CLIENT_8200",
  EXPORT_TOO_LARGE = "CLIENT_8201",

  // Batch errors (8300-8399)
  INVALID_PAGINATION = "CLIENT_8300",
  BATCH_LIMIT_EXCEEDED = "CLIENT_8301",

  // Rate limiting (8400-8499)
  RATE_LIMIT_EXCEEDED = "CLIENT_8400",
}

export enum ClientMgmtErrorCode {
  // Authorization aliases (13000-13099)
  UNAUTHORIZED_ACCESS = "CLIENT_MGMT_13000",
  SUPERADMIN_REQUIRED = "CLIENT_MGMT_13001",

  // Client aliases (13100-13199)
  CLIENT_NOT_FOUND = "CLIENT_MGMT_13100",
  CLIENT_ALREADY_RESTRICTED = "CLIENT_MGMT_13101",
  CLIENT_NOT_RESTRICTED = "CLIENT_MGMT_13102",
  INVALID_RESTRICTION_DURATION = "CLIENT_MGMT_13103",

  // Export aliases (13200-13299)
  EXPORT_GENERATION_FAILED = "CLIENT_MGMT_13200",
  EXPORT_TOO_LARGE = "CLIENT_MGMT_13201",

  // Batch/filter aliases (13300-13399)
  INVALID_PAGINATION = "CLIENT_MGMT_13300",
  BATCH_LIMIT_EXCEEDED = "CLIENT_MGMT_13301",

  // Rate limiting aliases (13400-13499)
  RATE_LIMIT_EXCEEDED = "CLIENT_MGMT_13400",
}

const CLIENT_TO_CLIENT_MGMT_CODE: Record<ClientErrorCode, ClientMgmtErrorCode> = {
  [ClientErrorCode.UNAUTHORIZED_ACCESS]: ClientMgmtErrorCode.UNAUTHORIZED_ACCESS,
  [ClientErrorCode.SUPERADMIN_REQUIRED]: ClientMgmtErrorCode.SUPERADMIN_REQUIRED,
  [ClientErrorCode.CLIENT_NOT_FOUND]: ClientMgmtErrorCode.CLIENT_NOT_FOUND,
  [ClientErrorCode.CLIENT_ALREADY_RESTRICTED]: ClientMgmtErrorCode.CLIENT_ALREADY_RESTRICTED,
  [ClientErrorCode.CLIENT_NOT_RESTRICTED]: ClientMgmtErrorCode.CLIENT_NOT_RESTRICTED,
  [ClientErrorCode.INVALID_RESTRICTION_DURATION]: ClientMgmtErrorCode.INVALID_RESTRICTION_DURATION,
  [ClientErrorCode.EXPORT_GENERATION_FAILED]: ClientMgmtErrorCode.EXPORT_GENERATION_FAILED,
  [ClientErrorCode.EXPORT_TOO_LARGE]: ClientMgmtErrorCode.EXPORT_TOO_LARGE,
  [ClientErrorCode.INVALID_PAGINATION]: ClientMgmtErrorCode.INVALID_PAGINATION,
  [ClientErrorCode.BATCH_LIMIT_EXCEEDED]: ClientMgmtErrorCode.BATCH_LIMIT_EXCEEDED,
  [ClientErrorCode.RATE_LIMIT_EXCEEDED]: ClientMgmtErrorCode.RATE_LIMIT_EXCEEDED,
};

const CLIENT_MGMT_TO_CLIENT_CODE: Record<ClientMgmtErrorCode, ClientErrorCode> = {
  [ClientMgmtErrorCode.UNAUTHORIZED_ACCESS]: ClientErrorCode.UNAUTHORIZED_ACCESS,
  [ClientMgmtErrorCode.SUPERADMIN_REQUIRED]: ClientErrorCode.SUPERADMIN_REQUIRED,
  [ClientMgmtErrorCode.CLIENT_NOT_FOUND]: ClientErrorCode.CLIENT_NOT_FOUND,
  [ClientMgmtErrorCode.CLIENT_ALREADY_RESTRICTED]: ClientErrorCode.CLIENT_ALREADY_RESTRICTED,
  [ClientMgmtErrorCode.CLIENT_NOT_RESTRICTED]: ClientErrorCode.CLIENT_NOT_RESTRICTED,
  [ClientMgmtErrorCode.INVALID_RESTRICTION_DURATION]: ClientErrorCode.INVALID_RESTRICTION_DURATION,
  [ClientMgmtErrorCode.EXPORT_GENERATION_FAILED]: ClientErrorCode.EXPORT_GENERATION_FAILED,
  [ClientMgmtErrorCode.EXPORT_TOO_LARGE]: ClientErrorCode.EXPORT_TOO_LARGE,
  [ClientMgmtErrorCode.INVALID_PAGINATION]: ClientErrorCode.INVALID_PAGINATION,
  [ClientMgmtErrorCode.BATCH_LIMIT_EXCEEDED]: ClientErrorCode.BATCH_LIMIT_EXCEEDED,
  [ClientMgmtErrorCode.RATE_LIMIT_EXCEEDED]: ClientErrorCode.RATE_LIMIT_EXCEEDED,
};

const CLIENT_ERROR_CODES = new Set<string>(Object.values(ClientErrorCode));
const CLIENT_MGMT_ERROR_CODES = new Set<string>(Object.values(ClientMgmtErrorCode));

export interface ClientErrorResponse {
  success: false;
  error: {
    code: ClientErrorCode;
    alias_code?: ClientMgmtErrorCode;
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

export function toClientErrorCode(code: ClientErrorCode): ErrorCode {
  return code as unknown as ErrorCode;
}

export function toClientMgmtErrorCode(code: ClientErrorCode): ClientMgmtErrorCode {
  return CLIENT_TO_CLIENT_MGMT_CODE[code];
}

export function createClientError(
  code: ClientErrorCode,
  message: string,
  statusCode: number,
  requestId: string,
  details?: Record<string, unknown>
): AppError {
  return new AppError(toClientErrorCode(code), message, statusCode, details, requestId);
}

export function toClientErrorResponse(
  code: ClientErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
  responseTime?: number
): ClientErrorResponse {
  return {
    success: false,
    error: {
      code,
      alias_code: toClientMgmtErrorCode(code),
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

export function extractClientErrorCode(error: AppError): ClientErrorCode | null {
  const value = String(error.code);
  if (CLIENT_ERROR_CODES.has(value)) {
    return value as ClientErrorCode;
  }

  if (CLIENT_MGMT_ERROR_CODES.has(value)) {
    return CLIENT_MGMT_TO_CLIENT_CODE[value as ClientMgmtErrorCode];
  }

  return null;
}
