// server/lib/payment.ts
import { createXenditInvoice, toPaymentGatewayUserMessage } from "./xendit";
import { resolveAppBaseUrl, resolvePaymentReturnBaseUrl } from "@/lib/utils/app-base-url";

export { resolveAppBaseUrl, resolvePaymentReturnBaseUrl };
export { toPaymentGatewayUserMessage };

export interface PaymentIntentResult {
  id: string; // Xendit invoice id
  clientSecret: string; // not used by Xendit, kept for compatibility – set to invoice_url
  status: string;
  amount: number;
  currency: string;
}

export interface PriceBreakdown {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  shippingAmount: number;
  totalAmount: number;
  currency: string;
}

export function getDefaultCurrency(): string {
  return (process.env.MARKETPLACE_CURRENCY ?? "PHP").toUpperCase();
}


export function buildPaymentSuccessUrl(baseUrl: string, params: { sessionId?: string; orderNumber?: string }): string {
  const url = new URL("/payment/success", baseUrl);
  if (params.sessionId) url.searchParams.set("session_id", params.sessionId);
  if (params.orderNumber) url.searchParams.set("order", params.orderNumber);
  return url.toString();
}

export function buildPaymentFailureUrl(baseUrl: string, params: { sessionId?: string; orderNumber?: string }): string {
  const url = new URL("/payment/failure", baseUrl);
  if (params.sessionId) url.searchParams.set("session_id", params.sessionId);
  if (params.orderNumber) url.searchParams.set("order", params.orderNumber);
  return url.toString();
}

export function getTaxRate(): number {
  return Math.max(0, Math.min(1, parseFloat(process.env.TAX_RATE ?? "0")));
}

function getFlatShippingCents(): number {
  return Math.max(0, parseInt(process.env.SHIPPING_RATE_FLAT ?? "0", 10));
}

function getFreeShippingThreshold(): number {
  return Math.max(0, parseFloat(process.env.FREE_SHIPPING_THRESHOLD ?? "0"));
}

export function calculatePriceBreakdown(
  subtotalDollars: number,
  discountDollars: number,
  hasPhysicalItems: boolean,
): PriceBreakdown {
  const currency = getDefaultCurrency();
  const subtotal = Math.round(subtotalDollars * 100) / 100;
  const discount = Math.min(Math.round(discountDollars * 100) / 100, subtotal);
  const taxBase = Math.max(0, subtotal - discount);
  const taxAmount = Math.round(taxBase * getTaxRate() * 100) / 100;

  let shippingAmount = 0;
  if (hasPhysicalItems) {
    const threshold = getFreeShippingThreshold();
    if (threshold > 0 && taxBase >= threshold) shippingAmount = 0;
    else shippingAmount = getFlatShippingCents() / 100;
  }

  const totalAmount =
    Math.round((taxBase + taxAmount + shippingAmount) * 100) / 100;
  return {
    subtotal,
    discountAmount: discount,
    taxAmount,
    shippingAmount,
    totalAmount,
    currency,
  };
}

/**
 * Create a Xendit invoice – replaces createPaymentIntent.
 * Returns a Promise that never rejects; on error returns null.
 * Use createPaymentIntentDetailed when you need the gateway error message.
 */
export async function createPaymentIntent(
  amount: number,
  currency: string,
  options?: {
    userId?: string;
    planId?: string;
    billingCycle?: string;
    action?: string;
    payerEmail?: string;
    customerName?: string;
    description?: string;
    orderNumber?: string;
    successRedirectUrl?: string;    // ✅ added
    failureRedirectUrl?: string;    // ✅ added
    items?: Array<{                // ✅ added (or you can keep as string JSON)
      name: string;
      quantity: number;
      price: number;
      category?: string;
    }>;
    metadata?: Record<string, string>;
  },
): Promise<PaymentIntentResult | null> {
  const detailed = await createPaymentIntentDetailed(amount, currency, options);
  return detailed.ok ? detailed.payment : null;
}

export type CreatePaymentIntentDetailedResult =
  | { ok: true; payment: PaymentIntentResult }
  | { ok: false; error: string };

/**
 * Same as createPaymentIntent but returns a structured error message for API responses.
 */
export async function createPaymentIntentDetailed(
  amount: number,
  currency: string,
  options?: {
    userId?: string;
    planId?: string;
    billingCycle?: string;
    action?: string;
    payerEmail?: string;
    customerName?: string;
    description?: string;
    orderNumber?: string;
    successRedirectUrl?: string;
    failureRedirectUrl?: string;
    items?: Array<{
      name: string;
      quantity: number;
      price: number;
      category?: string;
    }>;
    metadata?: Record<string, string>;
  },
): Promise<CreatePaymentIntentDetailedResult> {
  if (amount <= 0) {
    return { ok: false, error: "Payment amount must be greater than zero." };
  }
  try {
    const successUrl = options?.successRedirectUrl?.trim();
    const failureUrl = options?.failureRedirectUrl?.trim();
    if (successUrl && !/^https?:\/\//i.test(successUrl)) {
      throw new Error(`[createPaymentIntent] successRedirectUrl must be absolute: ${successUrl}`);
    }
    if (failureUrl && !/^https?:\/\//i.test(failureUrl)) {
      throw new Error(`[createPaymentIntent] failureRedirectUrl must be absolute: ${failureUrl}`);
    }

    const invoice = await createXenditInvoice({
      externalId: options?.orderNumber ?? `inv_${Date.now()}`,
      amount,
      payerEmail: options?.payerEmail ?? "customer@example.com",
      description: options?.description ?? "Payment",
      currency: currency.toUpperCase(),
      successRedirectUrl: options?.successRedirectUrl,
      failureRedirectUrl: options?.failureRedirectUrl,
      customer: options?.customerName
        ? { givenNames: options.customerName, email: options.payerEmail }
        : undefined,
      items: options?.items,
      metadata: options?.metadata,
      invoiceDurationSeconds: 86400,
    });
    return {
      ok: true,
      payment: {
        id: invoice.id,
        clientSecret: invoice.invoice_url,
        status: invoice.status,
        amount: invoice.amount,
        currency: currency,
      },
    };
  } catch (err) {
    console.error("[createPaymentIntent] Xendit error:", err);
    return { ok: false, error: toPaymentGatewayUserMessage(err) };
  }
}

/**
 * Generate a unique order number.
 */
export function generateOrderNumber(): string {
  const date = new Date();
  const yyyymmdd =
    date.getFullYear().toString() +
    String(date.getMonth() + 1).padStart(2, "0") +
    String(date.getDate()).padStart(2, "0");
  const suffix = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `ORD-${yyyymmdd}-${suffix}`;
}

/**
 * Proration calculation – unchanged.
 */
export function calculateProration(
  currentPlanMonthlyPrice: number,
  billingCycle: "monthly" | "yearly",
  cycleStartDate: Date,
  cycleEndDate: Date,
): number {
  const now = Date.now();
  const total = cycleEndDate.getTime() - cycleStartDate.getTime();
  const remaining = Math.max(0, cycleEndDate.getTime() - now);
  const fraction = total > 0 ? remaining / total : 0;
  const effectiveMonthlyPrice =
    billingCycle === "yearly"
      ? (currentPlanMonthlyPrice * 12 * 0.8) / 12
      : currentPlanMonthlyPrice;
  return Math.round(effectiveMonthlyPrice * fraction * 100) / 100;
}
