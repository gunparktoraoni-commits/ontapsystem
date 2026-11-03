import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors/types";
import {
  SettingsErrorCode,
  extractSettingsErrorCode,
  toSettingsErrorResponse,
} from "@/lib/errors/settings-errors";

function mapStatusToSettingsCode(status: number): SettingsErrorCode {
  if (status === 400 || status === 422) return SettingsErrorCode.INVALID_REQUEST_PAYLOAD;
  if (status === 401) return SettingsErrorCode.UNAUTHORIZED_ACCESS;
  if (status === 403) return SettingsErrorCode.SUPERADMIN_REQUIRED;
  if (status === 404) return SettingsErrorCode.PROFILE_NOT_FOUND;
  if (status === 409) return SettingsErrorCode.PAYMENT_CHANNEL_NOT_FOUND;
  if (status === 429) return SettingsErrorCode.RATE_LIMIT_EXCEEDED;
  return SettingsErrorCode.INTERNAL_ERROR;
}

export function toSettingsErrorNextResponse(
  error: unknown,
  requestId: string,
  responseTime: number,
  fallbackMessage: string
): NextResponse {
  if (error instanceof AppError) {
    const code = extractSettingsErrorCode(error) ?? mapStatusToSettingsCode(error.statusCode);
    return NextResponse.json(
      toSettingsErrorResponse(
        code,
        error.message,
        error.requestId ?? requestId,
        error.details,
        responseTime
      ),
      { status: error.statusCode }
    );
  }

  return NextResponse.json(
    toSettingsErrorResponse(
      SettingsErrorCode.INTERNAL_ERROR,
      fallbackMessage,
      requestId,
      undefined,
      responseTime
    ),
    { status: 500 }
  );
}
