import crypto from "crypto";
import { prisma } from "@/server/lib/prisma";

const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface PaymentIdempotencyInput {
  idempotencyKey: string;
  userId: bigint;
  action: string;
  payload: unknown;
}

export interface PaymentIdempotencyResult {
  processed: boolean;
  result?: unknown;
  duplicate?: boolean;
}

/**
 * Check if a payment action has already been processed with the given idempotency key.
 * If found and not expired, return the cached result.
 * If expired, clean up and allow reprocessing.
 */
export async function checkPaymentIdempotency(
  input: PaymentIdempotencyInput
): Promise<PaymentIdempotencyResult> {
  const payloadHash = crypto.createHash("sha256").update(JSON.stringify(input.payload)).digest("hex");

  // Clean up expired entries first
  await prisma.paymentIdempotency.deleteMany({
    where: { expires_at: { lt: new Date() } },
  });

  const existing = await prisma.paymentIdempotency.findUnique({
    where: { idempotency_key: input.idempotencyKey },
  });

  if (!existing) {
    return { processed: false };
  }

  // Check if expired
  if (existing.expires_at < new Date()) {
    await prisma.paymentIdempotency.delete({
      where: { idempotency_key: input.idempotencyKey },
    });
    return { processed: false };
  }

  // Check if same user, action, and payload
  if (
    existing.user_id === input.userId &&
    existing.action === input.action &&
    existing.payload_hash === payloadHash
  ) {
    return {
      processed: true,
      result: existing.result ? JSON.parse(existing.result) : undefined,
      duplicate: true,
    };
  }

  // Different payload or user - treat as new request
  return { processed: false };
}

/**
 * Record a successful payment action result for idempotency.
 */
export async function recordPaymentIdempotency(
  input: PaymentIdempotencyInput,
  result: unknown
): Promise<void> {
  const payloadHash = crypto.createHash("sha256").update(JSON.stringify(input.payload)).digest("hex");
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS);

  await prisma.paymentIdempotency.upsert({
    where: { idempotency_key: input.idempotencyKey },
    update: {
      payload_hash: payloadHash,
      result: JSON.stringify(result),
      expires_at: expiresAt,
    },
    create: {
      idempotency_key: input.idempotencyKey,
      user_id: input.userId,
      action: input.action,
      payload_hash: payloadHash,
      result: JSON.stringify(result),
      expires_at: expiresAt,
    },
  });
}

/**
 * Process a payment action with idempotency, executing the processor only if not already processed.
 */
export async function processPaymentIdempotently<T>(
  input: PaymentIdempotencyInput,
  processor: () => Promise<T>
): Promise<PaymentIdempotencyResult & { result?: T }> {
  const check = await checkPaymentIdempotency(input);

  if (check.duplicate) {
    return check as PaymentIdempotencyResult & { result?: T };
  }

  try {
    const result = await processor();
    await recordPaymentIdempotency(input, result);
    return { processed: true, result };
  } catch (error) {
    // Don't record failed attempts for idempotency
    throw error;
  }
}