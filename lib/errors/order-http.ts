import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors/types";
import {
  OrderErrorCode,
  extractOrderErrorCode,
  toOrderErrorResponse,
} from "@/lib/errors/order-errors";

function mapStatusToOrderCode(status: number): OrderErrorCode {
  if (status === 400 || status === 422) return OrderErrorCode.INVALID_REQUEST_BODY;
  if (status === 401) return OrderErrorCode.UNAUTHORIZED_ACCESS;
  if (status === 403) return OrderErrorCode.SUPERADMIN_REQUIRED;
  if (status === 404) return OrderErrorCode.ORDER_NOT_FOUND;
  if (status === 409) return OrderErrorCode.ORDER_STATUS_TRANSITION_INVALID;
  if (status === 413) return OrderErrorCode.EXPORT_TOO_LARGE;
  if (status === 429) return OrderErrorCode.RATE_LIMIT_EXCEEDED;
  return OrderErrorCode.INTERNAL_ERROR;
}

export function toOrderErrorNextResponse(
  error: unknown,
  requestId: string,
  responseTime: number,
  fallbackMessage: string
): NextResponse {
  if (error instanceof AppError) {
    const code = extractOrderErrorCode(error) ?? mapStatusToOrderCode(error.statusCode);
    return NextResponse.json(
      toOrderErrorResponse(
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
    toOrderErrorResponse(
      OrderErrorCode.INTERNAL_ERROR,
      fallbackMessage,
      requestId,
      undefined,
      responseTime
    ),
    { status: 500 }
  );
}
