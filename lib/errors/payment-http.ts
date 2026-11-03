import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors/types";
import {
  PaymentErrorCode,
  extractPaymentErrorCode,
  toPaymentErrorResponse,
} from "@/lib/errors/payment-errors";

function mapStatusToPaymentCode(status: number): PaymentErrorCode {
  if (status === 400 || status === 422) return PaymentErrorCode.WEBHOOK_PAYLOAD_INVALID;
  if (status === 401) return PaymentErrorCode.WEBHOOK_SIGNATURE_INVALID;
  if (status === 403) return PaymentErrorCode.PAYMENT_UNAUTHORIZED;
  if (status === 404) return PaymentErrorCode.WEBHOOK_ORDER_NOT_FOUND;
  if (status === 409) return PaymentErrorCode.DUPLICATE_PAYMENT_REQUEST;
  if (status === 429) return PaymentErrorCode.CHECKOUT_RATE_LIMIT;
  return PaymentErrorCode.INVOICE_CREATION_FAILED;
}

export function toPaymentErrorNextResponse(
  error: unknown,
  requestId: string,
  responseTime: number,
  fallbackMessage: string
): NextResponse {
  if (error instanceof AppError) {
    const code = extractPaymentErrorCode(error) ?? mapStatusToPaymentCode(error.statusCode);
    return NextResponse.json(
      toPaymentErrorResponse(
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
    toPaymentErrorResponse(
      PaymentErrorCode.INVOICE_CREATION_FAILED,
      fallbackMessage,
      requestId,
      undefined,
      responseTime
    ),
    { status: 500 }
  );
}