import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors/types";
import {
  AuthErrorCode,
  extractAuthErrorCode,
  toAuthErrorResponse,
} from "@/lib/errors/auth-errors";

function mapStatusToAuthCode(status: number): AuthErrorCode {
  if (status === 400 || status === 422) return AuthErrorCode.INVALID_REQUEST_PAYLOAD;
  if (status === 401) return AuthErrorCode.UNAUTHORIZED_ACCESS;
  if (status === 403) return AuthErrorCode.ADMIN_ROLE_REQUIRED;
  if (status === 404) return AuthErrorCode.SESSION_NOT_FOUND;
  if (status === 409) return AuthErrorCode.PASSWORD_REUSE_NOT_ALLOWED;
  if (status === 429) return AuthErrorCode.RATE_LIMIT_EXCEEDED;
  return AuthErrorCode.INTERNAL_ERROR;
}

export function toAuthErrorNextResponse(
  error: unknown,
  requestId: string,
  responseTime: number,
  fallbackMessage: string
): NextResponse {
  if (error instanceof AppError) {
    const code = extractAuthErrorCode(error) ?? mapStatusToAuthCode(error.statusCode);
    return NextResponse.json(
      toAuthErrorResponse(code, error.message, error.requestId ?? requestId, error.details, responseTime),
      { status: error.statusCode }
    );
  }

  return NextResponse.json(
    toAuthErrorResponse(AuthErrorCode.INTERNAL_ERROR, fallbackMessage, requestId, undefined, responseTime),
    { status: 500 }
  );
}
