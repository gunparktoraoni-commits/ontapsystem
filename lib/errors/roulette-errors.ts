/**
 * Roulette Spin System Error Codes
 * Range: ROULETTE_30000 - ROULETTE_30099
 */

export enum RouletteErrorCode {
  // Spin errors
  NO_SPINS_AVAILABLE = 'ROULETTE_30000',
  SPIN_ALREADY_RECORDED = 'ROULETTE_30004',
  INVALID_PRIZE_TYPE = 'ROULETTE_30005',
  SPIN_RATE_LIMIT = 'ROULETTE_30006',
  
  // Voucher errors
  INVALID_VOUCHER = 'ROULETTE_30001',
  VOUCHER_EXPIRED = 'ROULETTE_30002',
  VOUCHER_ALREADY_USED = 'ROULETTE_30003',
  VOUCHER_MIN_PURCHASE_NOT_MET = 'ROULETTE_30007',
  VOUCHER_NOT_APPLICABLE = 'ROULETTE_30008',
  
  // Order errors
  ORDER_NOT_COMPLETED = 'ROULETTE_30009',
  SPINS_ALREADY_AWARDED = 'ROULETTE_30010',
  
  // System errors
  PRIZE_GENERATION_FAILED = 'ROULETTE_30011',
  VOUCHER_CREATION_FAILED = 'ROULETTE_30012',
}

export interface RouletteErrorResponse {
  success: false;
  error: {
    code: RouletteErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
  meta?: {
    requestId: string;
    timestamp: string;
  };
}

export function createRouletteError(
  code: RouletteErrorCode,
  message: string,
  details?: Record<string, unknown>
): RouletteErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details && { details }),
    },
  };
}

export function createNoSpinsError(redirectUrl?: string): RouletteErrorResponse {
  return createRouletteError(
    RouletteErrorCode.NO_SPINS_AVAILABLE,
    'No spins available. Complete purchases to earn more spins!',
    { redirect_url: redirectUrl || '/marketplace/orders' }
  );
}

export function createInvalidVoucherError(voucherCode: string): RouletteErrorResponse {
  return createRouletteError(
    RouletteErrorCode.INVALID_VOUCHER,
    `Invalid or expired voucher code: ${voucherCode}`,
    { voucher_code: voucherCode }
  );
}

export function createVoucherExpiredError(voucherCode: string, expiredAt: Date): RouletteErrorResponse {
  return createRouletteError(
    RouletteErrorCode.VOUCHER_EXPIRED,
    `Voucher ${voucherCode} expired on ${expiredAt.toISOString()}`,
    { voucher_code: voucherCode, expired_at: expiredAt.toISOString() }
  );
}

export function createVoucherAlreadyUsedError(voucherCode: string, orderId?: string): RouletteErrorResponse {
  return createRouletteError(
    RouletteErrorCode.VOUCHER_ALREADY_USED,
    `Voucher ${voucherCode} has already been used${orderId ? ` in order ${orderId}` : ''}`,
    { voucher_code: voucherCode, ...(orderId && { used_in_order_id: orderId }) }
  );
}

export function createOrderNotCompletedError(orderId: string | bigint): RouletteErrorResponse {
  return createRouletteError(
    RouletteErrorCode.ORDER_NOT_COMPLETED,
    `Order ${orderId} must be completed before spins can be awarded`,
    { order_id: String(orderId) }
  );
}

export function createRateLimitError(retryAfterSeconds: number): RouletteErrorResponse {
  return createRouletteError(
    RouletteErrorCode.SPIN_RATE_LIMIT,
    `Too many spin attempts. Please try again in ${retryAfterSeconds} seconds.`,
    { retry_after_seconds: retryAfterSeconds }
  );
}
