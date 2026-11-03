/**
 * Payment-related error codes for standardized error handling.
 * Used across Xendit payment flows, webhooks, and checkout APIs.
 */

import { AppError } from "@/lib/errors/types";

export enum PaymentErrorCode {
  // Payment processing (26000-26099)
  INVOICE_CREATION_FAILED = 'PAYMENT_26000',
  INVOICE_ALREADY_PAID = 'PAYMENT_26001',
  INVOICE_EXPIRED = 'PAYMENT_26002',
  PRICE_MISMATCH = 'PAYMENT_26003',
  PAYMENT_AMOUNT_INVALID = 'PAYMENT_26004',
  PAYMENT_CURRENCY_INVALID = 'PAYMENT_26005',
  PAYMENT_METHOD_INVALID = 'PAYMENT_26006',

  // Webhook errors (26100-26199)
  WEBHOOK_SIGNATURE_INVALID = 'PAYMENT_26100',
  WEBHOOK_EVENT_DUPLICATE = 'PAYMENT_26101',
  WEBHOOK_EVENT_UNKNOWN = 'PAYMENT_26102',
  WEBHOOK_PAYLOAD_INVALID = 'PAYMENT_26103',
  WEBHOOK_AMOUNT_MISMATCH = 'PAYMENT_26104',
  WEBHOOK_ORDER_NOT_FOUND = 'PAYMENT_26105',

  // Idempotency (26200-26299)
  DUPLICATE_PAYMENT_REQUEST = 'PAYMENT_26200',
  IDEMPOTENCY_KEY_EXPIRED = 'PAYMENT_26201',
  IDEMPOTENCY_KEY_INVALID = 'PAYMENT_26202',

  // Rate limiting (26300-26399)
  CHECKOUT_RATE_LIMIT = 'PAYMENT_26300',
  WEBHOOK_RATE_LIMIT = 'PAYMENT_26301',
  ORDER_STATUS_RATE_LIMIT = 'PAYMENT_26302',

  // Authorization (26400-26499)
  PAYMENT_UNAUTHORIZED = 'PAYMENT_26400',
  ORDER_ACCESS_DENIED = 'PAYMENT_26401',

  // Validation (26500-26599)
  CART_EMPTY = 'PAYMENT_26500',
  PRODUCT_UNAVAILABLE = 'PAYMENT_26501',
  SUBSCRIPTION_PLAN_INVALID = 'PAYMENT_26502',
  BILLING_CYCLE_INVALID = 'PAYMENT_26503',
  SUBSCRIPTION_DOWNGRADE_NOT_ALLOWED = 'PAYMENT_26504',  // ← NEW: Added this line

  // Checkout specific (26600-26699)
  CHECKOUT_INVALID_REQUEST = 'PAYMENT_26600',
  CHECKOUT_VALIDATION_FAILED = 'PAYMENT_26601',
  CHECKOUT_EMPTY_CART = 'PAYMENT_26602',
  CHECKOUT_INVALID_PROMO_CODE = 'PAYMENT_26603',
  CHECKOUT_PROMO_MIN_PURCHASE = 'PAYMENT_26604',
  CHECKOUT_PROMO_USAGE_LIMIT = 'PAYMENT_26605',
  CHECKOUT_PROMO_USER_LIMIT = 'PAYMENT_26606',
  CHECKOUT_PROCESSING_FAILED = 'PAYMENT_26607',
}

export interface PaymentErrorResponse {
  success: false;
  error: {
    code: PaymentErrorCode;
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

export function extractPaymentErrorCode(error: AppError): PaymentErrorCode | null {
  if (error.code && typeof error.code === 'string' && error.code.startsWith('PAYMENT_')) {
    return error.code as unknown as PaymentErrorCode;
  }
  return null;
}

export function toPaymentErrorResponse(
  code: PaymentErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
  responseTime?: number
): PaymentErrorResponse {
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
      responseTime,
    },
  };
}