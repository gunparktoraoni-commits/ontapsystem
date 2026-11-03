import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors/types";
import {
  OrderMgmtErrorCode,
  extractOrderMgmtErrorCode,
  toOrderMgmtErrorResponse,
} from "@/lib/errors/order-mgmt-errors";

function mapStatusToOrderMgmtCode(status: number): OrderMgmtErrorCode {
  if (status === 400 || status === 422) return OrderMgmtErrorCode.INVALID_REQUEST_BODY;
  if (status === 401) return OrderMgmtErrorCode.UNAUTHORIZED_ACCESS;
  if (status === 403) return OrderMgmtErrorCode.SUPERADMIN_REQUIRED;
  if (status === 404) return OrderMgmtErrorCode.ORDER_NOT_FOUND;
  if (status === 409) return OrderMgmtErrorCode.ORDER_STATUS_TRANSITION_INVALID;
  if (status === 413) return OrderMgmtErrorCode.EXPORT_TOO_LARGE;
  if (status === 429) return OrderMgmtErrorCode.RATE_LIMIT_EXCEEDED;
  return OrderMgmtErrorCode.INTERNAL_ERROR;
}

export function toOrderMgmtErrorNextResponse(
  error: unknown,
  requestId: string,
  responseTime: number,
  fallbackMessage: string
): NextResponse {
  if (error instanceof AppError) {
    const code = extractOrderMgmtErrorCode(error) ?? mapStatusToOrderMgmtCode(error.statusCode);
    return NextResponse.json(
      toOrderMgmtErrorResponse(
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
    toOrderMgmtErrorResponse(
      OrderMgmtErrorCode.INTERNAL_ERROR,
      fallbackMessage,
      requestId,
      undefined,
      responseTime
    ),
    { status: 500 }
  );
}
