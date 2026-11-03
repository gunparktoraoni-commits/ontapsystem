import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors/types";
import {
  DatabaseReconcileErrorCode,
  extractDatabaseReconcileErrorCode,
  toDatabaseReconcileErrorResponse,
} from "@/lib/errors/database-reconcile-errors";

function mapStatusToReconcileCode(status: number): DatabaseReconcileErrorCode {
  if (status === 400 || status === 422) return DatabaseReconcileErrorCode.INVALID_SQL_FILE;
  if (status === 401) return DatabaseReconcileErrorCode.USER_NOT_FOUND;
  if (status === 403) return DatabaseReconcileErrorCode.REFERENTIAL_INTEGRITY_ERROR;
  if (status === 404) return DatabaseReconcileErrorCode.SOURCE_DATA_UNAVAILABLE;
  if (status === 409) return DatabaseReconcileErrorCode.REFERENTIAL_INTEGRITY_ERROR;
  if (status === 413) return DatabaseReconcileErrorCode.SQL_FILE_TOO_LARGE;
  if (status === 429) return DatabaseReconcileErrorCode.RATE_LIMIT_EXCEEDED;
  return DatabaseReconcileErrorCode.INTERNAL_ERROR;
}

export function toDatabaseReconcileErrorNextResponse(
  error: unknown,
  requestId: string,
  responseTime: number,
  fallbackMessage: string
): NextResponse {
  if (error instanceof AppError) {
    const code = extractDatabaseReconcileErrorCode(error) ?? mapStatusToReconcileCode(error.statusCode);
    return NextResponse.json(
      toDatabaseReconcileErrorResponse(
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
    toDatabaseReconcileErrorResponse(
      DatabaseReconcileErrorCode.INTERNAL_ERROR,
      fallbackMessage,
      requestId,
      undefined,
      responseTime
    ),
    { status: 500 }
  );
}
