import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors/types";
import {
  ClientErrorCode,
  extractClientErrorCode,
  toClientErrorResponse,
} from "@/lib/errors/client-errors";

function mapStatusToClientCode(status: number): ClientErrorCode {
  if (status === 401) return ClientErrorCode.UNAUTHORIZED_ACCESS;
  if (status === 403) return ClientErrorCode.SUPERADMIN_REQUIRED;
  if (status === 404) return ClientErrorCode.CLIENT_NOT_FOUND;
  if (status === 409) return ClientErrorCode.CLIENT_NOT_RESTRICTED;
  if (status === 413) return ClientErrorCode.EXPORT_TOO_LARGE;
  if (status === 429) return ClientErrorCode.RATE_LIMIT_EXCEEDED;
  if (status === 400 || status === 422) return ClientErrorCode.INVALID_PAGINATION;
  return ClientErrorCode.EXPORT_GENERATION_FAILED;
}

export function toClientErrorNextResponse(
  error: unknown,
  requestId: string,
  responseTime: number,
  fallbackMessage: string
): NextResponse {
  if (error instanceof AppError) {
    const code = extractClientErrorCode(error) ?? mapStatusToClientCode(error.statusCode);
    return NextResponse.json(
      toClientErrorResponse(
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
    toClientErrorResponse(
      ClientErrorCode.EXPORT_GENERATION_FAILED,
      fallbackMessage,
      requestId,
      undefined,
      responseTime
    ),
    { status: 500 }
  );
}
