import crypto from "crypto";
import { safeCompare } from "./timing-safe";

const XENDIT_BASE_URL = "https://api.xendit.co";

/** Structured Xendit API failure — safe to surface a user-facing message. */
export class XenditApiError extends Error {
  readonly errorCode: string;
  readonly httpStatus: number;

  constructor(message: string, errorCode: string, httpStatus: number) {
    super(message);
    this.name = "XenditApiError";
    this.errorCode = errorCode;
    this.httpStatus = httpStatus;
  }
}

/**
 * Maps Xendit failures to a checkout-safe message (no secrets).
 * REQUEST_FORBIDDEN_ERROR usually means the secret key is revoked or lacks Invoice write permission.
 */
export function toPaymentGatewayUserMessage(err: unknown): string {
  if (err instanceof XenditApiError) {
    if (
      err.errorCode === "REQUEST_FORBIDDEN_ERROR" ||
      err.httpStatus === 401 ||
      err.httpStatus === 403
    ) {
      return "Payment gateway rejected invoice creation. Your Xendit secret key can read invoices but cannot create them. Generate a NEW Live secret key with Money-in = Write, put that full key into portal XENDIT_SECRET_KEY, then redeploy.";
    }
    if (err.errorCode === "API_VALIDATION_ERROR") {
      return err.message || "Payment request was rejected by the payment gateway.";
    }
    return err.message || "Payment gateway unavailable. Please try again later.";
  }
  if (err instanceof Error && err.message.trim()) {
    if (/secret key|xnd_/i.test(err.message)) {
      return "Payment gateway is misconfigured. Check XENDIT_SECRET_KEY in the portal environment.";
    }
    return err.message;
  }
  return "Payment gateway unavailable. Please try again later.";
}

// ============= Types =============
export type XenditInvoiceStatus = "PENDING" | "PAID" | "SETTLED" | "EXPIRED" | "FAILED" | "VOIDED";
export type XenditSubscriptionStatus = "ACTIVE" | "INACTIVE" | "PAUSED" | "EXPIRED";
export type XenditPaymentMethodType = "CARD" | "BANK_ACCOUNT" | "EWALLET" | "QR_CODE" | "DIRECT_DEBIT";

export interface XenditCustomer {
  id: string;
  reference_id: string;
  email: string;
  given_names?: string;
  surname?: string;
  mobile_number?: string;
  phone_number?: string;
}

export interface XenditPaymentMethod {
  id: string;
  type: XenditPaymentMethodType;
  status: "ACTIVE" | "INACTIVE" | "EXPIRED";
  customer_id: string;
  properties?: {
    card_brand?: string;
    masked_card_number?: string;
    channel_code?: string;
  };
}

export interface XenditInvoiceRequest {
  externalId: string;
  amount: number;
  payerEmail: string;
  payerName?: string;
  description: string;
  currency: string;
  successRedirectUrl?: string;
  failureRedirectUrl?: string;
  customer?: {
    givenNames?: string;
    surname?: string;
    email?: string;
    mobileNumber?: string;
    phoneNumber?: string;
  };
  items?: Array<{
    name: string;
    quantity: number;
    price: number;
    category?: string;
    url?: string;
  }>;
  invoiceDurationSeconds?: number;
  customerNotificationPreference?: {
    invoiceCreated?: string[];
    invoiceReminder?: string[];
    invoicePaid?: string[];
    invoiceExpired?: string[];
  };
  metadata?: Record<string, string>;   // ✅ added
}

export interface XenditInvoiceResponse {
  id: string;
  external_id: string;
  user_id: string;
  amount: number;
  invoice_url: string;
  status: XenditInvoiceStatus;
  expiry_date: string;
  payer_email: string;
  description: string;
}

export interface XenditWebhookPayload {
  id: string;
  external_id: string;
  user_id: string;
  status: XenditInvoiceStatus;
  paid_at?: string;
  payment_method?: string;
  payment_channel?: string;
  payment_id?: string;
  amount: number;
  currency: string;
  paid_amount?: number;
  adjusted_received_amount?: number;
  fees_paid_amount?: number;
}

// ============= Configuration =============
export function getXenditCurrency(): string {
  return (process.env.XENDIT_CURRENCY ?? "PHP").toUpperCase();
}

import { resolveAppBaseUrl } from "@/lib/utils/app-base-url";

export function getXenditCallbackUrl(): string {
  const explicit = process.env.XENDIT_WEBHOOK_CALLBACK_URL;
  if (explicit && explicit.trim()) return explicit.trim();
  try {
    return `${resolveAppBaseUrl()}/api/xendit/webhook`;
  } catch {
    return "";
  }
}

export function validateXenditSecretKey(key: string | undefined): boolean {
  if (!key) return false;
  // Development: xnd_development_*, Production: xnd_production_*
  return key.startsWith("xnd_development_") || key.startsWith("xnd_production_");
}

// ========== Helper Functions ==========
function getAuthorizationHeader(secretKey: string): string {
  const basicToken = Buffer.from(`${secretKey}:`).toString("base64");
  return `Basic ${basicToken}`;
}

function getSecretKeyOrThrow(): string {
  const key = getXenditSecretKeyOrNull();
  if (!key) {
    throw new Error("Invalid or missing Xendit secret key. Must start with xnd_development_ or xnd_production_");
  }
  return key;
}

/** Non-throwing variant for read/poll paths (order status reconciliation). */
export function getXenditSecretKeyOrNull(): string | null {
  const key = process.env.XENDIT_SECRET_KEY?.trim();
  if (!key || !validateXenditSecretKey(key)) {
    return null;
  }

  if (process.env.NODE_ENV === "production" && key.startsWith("xnd_development_")) {
    console.warn("[Xendit] WARNING: Development key is being used in production environment.");
  } else if (key.startsWith("xnd_production_")) {
    // Quiet confirmation once per process is enough for ops; avoid noisy logs.
  }

  return key;
}

/** Safe label for ops/diagnostics — never returns the raw secret. */
export function getXenditMode(): "production" | "development" | "missing" | "invalid" {
  const key = process.env.XENDIT_SECRET_KEY?.trim() ?? "";
  if (!key) return "missing";
  if (key.startsWith("xnd_production_")) return "production";
  if (key.startsWith("xnd_development_")) return "development";
  return "invalid";
}

function getIdempotencyKey(prefix: string, id: string): string {
  return crypto.createHash("sha256").update(`${prefix}:${id}:${Date.now()}`).digest("hex").substring(0, 64);
}

// ============= Customer Management =============
export async function createXenditCustomer(input: {
  referenceId: string;
  email: string;
  givenNames?: string;
  surname?: string;
  phoneNumber?: string;
}): Promise<XenditCustomer> {
  const secretKey = getSecretKeyOrThrow();

  const payload = {
    reference_id: input.referenceId,
    email: input.email,
    given_names: input.givenNames,
    surname: input.surname,
    phone_number: input.phoneNumber,
  };

  const response = await fetch(`${XENDIT_BASE_URL}/customers`, {
    method: "POST",
    headers: {
      Authorization: getAuthorizationHeader(secretKey),
      "Content-Type": "application/json",
      "X-IDEMPOTENCY-KEY": getIdempotencyKey("customer", input.referenceId),
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const data = await response.json();
  if (!response.ok) {
    const message = typeof data.message === "string" ? data.message : "Failed to create Xendit customer";
    throw new Error(message);
  }

  return data as XenditCustomer;
}

export async function getXenditCustomerByReferenceId(referenceId: string): Promise<XenditCustomer | null> {
  const secretKey = getSecretKeyOrThrow();

  const response = await fetch(`${XENDIT_BASE_URL}/customers?reference_id=${encodeURIComponent(referenceId)}`, {
    method: "GET",
    headers: { Authorization: getAuthorizationHeader(secretKey) },
    cache: "no-store",
  });

  if (!response.ok) return null;
  const data = await response.json();
  return data.data?.[0] || null;
}

// ============= Payment Method Management =============
export async function getXenditPaymentMethods(customerId: string): Promise<XenditPaymentMethod[]> {
  const secretKey = getSecretKeyOrThrow();

  const response = await fetch(`${XENDIT_BASE_URL}/payment_methods?customer_id=${encodeURIComponent(customerId)}`, {
    method: "GET",
    headers: { Authorization: getAuthorizationHeader(secretKey) },
    cache: "no-store",
  });

  if (!response.ok) return [];
  const data = await response.json();
  return data.data || [];
}

// ============= Invoice Management =============
export async function createXenditInvoice(input: XenditInvoiceRequest): Promise<XenditInvoiceResponse> {
  const secretKey = getSecretKeyOrThrow();
  const mode = getXenditMode();
  if (mode === "development") {
    console.warn(
      `[Xendit] Creating invoice in TEST mode (xnd_development_…). external_id=${input.externalId}`,
    );
  } else {
    console.info(
      `[Xendit] Creating invoice in LIVE mode. external_id=${input.externalId} amount=${input.amount} ${input.currency}`,
    );
  }
  // Amount handling: some deployments expect Xendit amounts in minor units
  // (smallest currency unit, e.g. cents). To preserve backward compatibility
  // we make this configurable via `XENDIT_USE_MINOR_UNITS` (default: false).
  const useMinorUnits = String(process.env.XENDIT_USE_MINOR_UNITS ?? "false").toLowerCase() === "true";

  if (!Number.isFinite(input.amount) || Number(input.amount) <= 0) {
    throw new Error(`Invalid amount: ${String(input.amount)} (must be a positive number)`);
  }

  const amountToSend = useMinorUnits ? Math.round(input.amount * 100) : Math.round(input.amount);

  const payload = {
    external_id: input.externalId,
    amount: amountToSend,
    payer_email: input.payerEmail,
    payer_name: input.payerName,
    description: input.description,
    currency: input.currency,
    success_redirect_url: input.successRedirectUrl,
    failure_redirect_url: input.failureRedirectUrl,
    customer: input.customer
      ? {
          given_names: input.customer.givenNames,
          surname: input.customer.surname,
          email: input.customer.email,
          mobile_number: input.customer.mobileNumber,
          phone_number: input.customer.phoneNumber,
        }
      : undefined,
    items: input.items?.map(item => ({
      name: item.name,
      quantity: item.quantity,
      // Same minor-unit handling as the top-level amount
      price: useMinorUnits ? Math.round(item.price * 100) : Math.round(item.price),
      category: item.category,
      url: item.url,
    })),
    invoice_duration: input.invoiceDurationSeconds ?? 86400, // 24 hours default
    // By default, avoid asking Xendit to send an "invoice_created" email
    // to prevent duplicate/conflicting notifications. Set XENDIT_SEND_INVOICE_CREATED_EMAIL=true
    // to opt-in to Xendit's invoice-created notifications.
    customer_notification_preference: input.customerNotificationPreference ?? (
      String(process.env.XENDIT_SEND_INVOICE_CREATED_EMAIL ?? "false").toLowerCase() === "true"
        ? {
            invoice_created: ["email"],
            invoice_reminder: ["email"],
            invoice_paid: ["email"],
            invoice_expired: ["email"],
          }
        : {
            invoice_created: [],
            invoice_reminder: ["email"],
            invoice_paid: ["email"],
            invoice_expired: ["email"],
          }
    ),
    metadata: input.metadata,
  };

  const response = await fetch(`${XENDIT_BASE_URL}/v2/invoices`, {
    method: "POST",
    headers: {
      Authorization: getAuthorizationHeader(secretKey),
      "Content-Type": "application/json",
      "X-IDEMPOTENCY-KEY": getIdempotencyKey("invoice", input.externalId),
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const data = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) {
    const errorCode =
      typeof (data as { error_code?: unknown }).error_code === "string"
        ? (data as { error_code: string }).error_code
        : "UNKNOWN_ERROR";
    const message =
      typeof (data as { message?: unknown }).message === "string"
        ? (data as { message: string }).message
        : "Failed to create Xendit invoice";
    console.error(`[Xendit Invoice Error] ${errorCode}: ${message}`);
    throw new XenditApiError(message, errorCode, response.status);
  }

  return data as XenditInvoiceResponse;
}

export async function getXenditInvoice(invoiceId: string): Promise<XenditInvoiceResponse | null> {
  const secretKey = getXenditSecretKeyOrNull();
  if (!secretKey) {
    return null;
  }

  const response = await fetch(`${XENDIT_BASE_URL}/v2/invoices/${encodeURIComponent(invoiceId)}`, {
    method: "GET",
    headers: { Authorization: getAuthorizationHeader(secretKey) },
    cache: "no-store",
  });

  if (!response.ok) return null;
  return response.json();
}

export async function expireXenditInvoice(invoiceId: string): Promise<boolean> {
  const secretKey = getSecretKeyOrThrow();

  const response = await fetch(`${XENDIT_BASE_URL}/v2/invoices/${encodeURIComponent(invoiceId)}/expire`, {
    method: "POST",
    headers: {
      Authorization: getAuthorizationHeader(secretKey),
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  return response.ok;
}

// ============= Subscription / Recurring Payments =============
export interface XenditSubscriptionRequest {
  externalId: string;
  customerId: string;
  paymentMethodId: string;
  amount: number;
  currency: string;
  interval: "DAY" | "WEEK" | "MONTH" | "YEAR";
  intervalCount: number;
  description: string;
  startDate?: Date;
  totalRecurrence?: number;
  successRedirectUrl?: string;
  failureRedirectUrl?: string;
}

export interface XenditSubscriptionResponse {
  id: string;
  status: XenditSubscriptionStatus;
  external_id: string;
  amount: number;
  currency: string;
  customer_id: string;
  payment_method_id: string;
  interval: string;
  interval_count: number;
}

export async function createXenditSubscription(input: XenditSubscriptionRequest): Promise<XenditSubscriptionResponse> {
  const secretKey = getSecretKeyOrThrow();
  const useMinorUnits = String(process.env.XENDIT_USE_MINOR_UNITS ?? "false").toLowerCase() === "true";
  const amountToSend = useMinorUnits ? Math.round(input.amount * 100) : Math.round(input.amount);
  const payload = {
    external_id: input.externalId,
    customer_id: input.customerId,
    payment_method_id: input.paymentMethodId,
    amount: amountToSend,
    currency: input.currency,
    interval: input.interval,
    interval_count: input.intervalCount,
    description: input.description,
    start_date: input.startDate?.toISOString(),
    total_recurrence: input.totalRecurrence,
    success_redirect_url: input.successRedirectUrl,
    failure_redirect_url: input.failureRedirectUrl,
  };

  const response = await fetch(`${XENDIT_BASE_URL}/recurring_payments`, {
    method: "POST",
    headers: {
      Authorization: getAuthorizationHeader(secretKey),
      "Content-Type": "application/json",
      "X-IDEMPOTENCY-KEY": getIdempotencyKey("subscription", input.externalId),
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(typeof data.message === "string" ? data.message : "Failed to create Xendit subscription");
  }

  return data as XenditSubscriptionResponse;
}

export async function cancelXenditSubscription(subscriptionId: string): Promise<boolean> {
  const secretKey = getSecretKeyOrThrow();

  const response = await fetch(`${XENDIT_BASE_URL}/recurring_payments/${encodeURIComponent(subscriptionId)}/cancel`, {
    method: "POST",
    headers: {
      Authorization: getAuthorizationHeader(secretKey),
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  return response.ok;
}

// ============= Webhook Security =============
export function verifyXenditWebhookToken(tokenFromHeader: string | null): boolean {
  const expected = process.env.XENDIT_WEBHOOK_TOKEN?.trim();
  if (!expected || !tokenFromHeader) return false;
  return safeCompare(tokenFromHeader.trim(), expected);
}

/**
 * Verify Xendit webhook callback token (different from webhook token)
 * Xendit sends a callback_token in the request body for invoice callbacks
 */
export function verifyXenditCallbackToken(callbackToken: string | null | undefined): boolean {
  const expected = process.env.XENDIT_CALLBACK_TOKEN?.trim();
  if (!expected || !callbackToken) return false;
  return safeCompare(callbackToken.trim(), expected);
}

// ============= IDempotency Helpers =============
export async function checkIdempotency(key: string, ttlSeconds: number = 86400): Promise<boolean> {
  // Implementation depends on Redis or database
  // For now, returns false (not processed)
  // You should implement this with Redis or a database table
  return false;
}

export async function storeIdempotencyKey(key: string, result: unknown, ttlSeconds: number = 86400): Promise<void> {
  // Store in Redis or database for idempotency
  // Implementation depends on your infrastructure
}