import { AppError, ErrorCode } from "@/lib/errors/types";

export enum AuthErrorCode {
  // Authorization and identity (17000-17099)
  UNAUTHORIZED_ACCESS = "AUTH_17000",
  ADMIN_ROLE_REQUIRED = "AUTH_17001",
  INVALID_CREDENTIALS = "AUTH_17002",
  ACCOUNT_LOCKED = "AUTH_17003",
  ACCOUNT_DEACTIVATED = "AUTH_17004",
  EMAIL_NOT_VERIFIED = "AUTH_17005",
  SESSION_NOT_FOUND = "AUTH_17006",
  INVALID_REFRESH_TOKEN = "AUTH_17007",

  // Password and recovery (17100-17199)
  FORGOT_PASSWORD_INVALID_REQUEST = "AUTH_17100",
  RESET_TOKEN_INVALID = "AUTH_17101",
  RESET_TOKEN_EXPIRED = "AUTH_17102",
  RESET_TOKEN_USED = "AUTH_17103",
  PASSWORD_POLICY_VIOLATION = "AUTH_17104",
  PASSWORD_MISMATCH = "AUTH_17105",
  CURRENT_PASSWORD_INVALID = "AUTH_17106",
  PASSWORD_REUSE_NOT_ALLOWED = "AUTH_17107",
  PASSWORD_RESET_EMAIL_SEND_FAILED = "AUTH_17108",

  // Validation (17200-17299)
  INVALID_REQUEST_PAYLOAD = "AUTH_17200",
  INVALID_EMAIL = "AUTH_17201",
  INVALID_TOKEN = "AUTH_17202",
  INVALID_PASSWORD = "AUTH_17203",

  // MFA reserved range (17300-17399)
  MFA_REQUIRED = "AUTH_17300",
  MFA_INVALID = "AUTH_17301",
  MFA_NOT_ENABLED = "AUTH_17302",

  // Rate limit and lockout (17400-17499)
  RATE_LIMIT_EXCEEDED = "AUTH_17400",
  LOCKOUT_ACTIVE = "AUTH_17401",

  // System (17500-17599)
  INTERNAL_ERROR = "AUTH_17500",
  DATABASE_ERROR = "AUTH_17501",
}

export interface AuthErrorResponse {
  success: false;
  error: {
    code: AuthErrorCode;
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

export function toAuthErrorCode(code: AuthErrorCode): ErrorCode {
  return code as unknown as ErrorCode;
}

export function createAuthError(
  code: AuthErrorCode,
  message: string,
  statusCode: number,
  requestId: string,
  details?: Record<string, unknown>
): AppError {
  return new AppError(toAuthErrorCode(code), message, statusCode, details, requestId);
}

export function toAuthErrorResponse(
  code: AuthErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
  responseTime?: number
): AuthErrorResponse {
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

export function extractAuthErrorCode(error: AppError): AuthErrorCode | null {
  const value = String(error.code);
  if (value.startsWith("AUTH_17")) {
    return value as AuthErrorCode;
  }
  return null;
}
