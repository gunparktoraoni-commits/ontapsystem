// ──────────────────────────────────────────────────────────────
// POST /api/affiliate/withdraw/request
// ──────────────────────────────────────────────────────────────
// Allows an affiliate to submit a withdrawal request.
//
// Security controls:
//   • Session + affiliate-gate required
//   • Balance check: amount must not exceed available_balance
//   • Minimum threshold check: amount must meet payment_threshold
//   • Valid withdrawal method required
//   • Idempotency: duplicate submissions within 1 minute are rejected
//     with the existing withdrawal returned (safe for retry)
//   • Payment details encrypted at rest with AES-256-GCM
//   • Rate limited: 5 requests per hour per IP
//
// Body:
//   { amount: number, method: string, account_details: { email?: string, ... }, notes?: string }
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  getAffiliateSettings,
  computeAvailableBalance,
  encryptPaymentDetails,
  buildWithdrawalIdempotencyKey,
} from "@/server/lib/affiliate";
import { createXenditInvoice } from "@/server/lib/xendit";
import { sendEmailMessage } from "@/server/lib/email";
import { sendSecurityAlert } from "@/server/lib/security-alerts";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

const VALID_METHODS = new Set(["paypal", "bank_transfer", "gcash"]);

/** Flip to true once the payout platform account is configured. */
const WITHDRAWALS_ENABLED = false;

async function sendAffiliateWithdrawalEmails(params: {
  userEmail: string;
  amount: number;
  currency: string;
  method: string;
  withdrawalId: string;
  invoiceId?: string;
  appUrl: string;
}) {
  const { userEmail, amount, currency, method, withdrawalId, invoiceId, appUrl } = params;
  const subject = "Your affiliate withdrawal request is received";
  const invoiceText = invoiceId
    ? `A Xendit reference invoice has been created: ${invoiceId}.`
    : "Your withdrawal request has been queued for manual review.";

  const html = `
    <h2 style="margin:0 0 16px;color:#2A4792;font-size:22px;">Withdrawal request received</h2>
    <p style="color:#495057;line-height:1.6;margin:0 0 16px;">
      We received your withdrawal request for <strong>${currency} ${amount.toFixed(2)}</strong> via <strong>${method}</strong>.
    </p>
    <p style="color:#495057;line-height:1.6;margin:0 0 16px;">
      Request ID: <strong>${withdrawalId}</strong>
    </p>
    <p style="color:#495057;line-height:1.6;margin:0 0 16px;">
      ${invoiceText}
    </p>
    <p style="color:#495057;line-height:1.6;margin:0 0 16px;">
      You can review your affiliate dashboard at <a href="${appUrl.replace(/\/$/, "")}/user/affiliate" style="color:#1d4ed8;">${appUrl.replace(/\/$/, "")}/user/affiliate</a>.
    </p>
    <p style="color:#6c757d;font-size:13px;margin:24px 0 0;">
      If you did not initiate this request, please contact support immediately.
    </p>
  `;

  await sendEmailMessage({
    to: userEmail,
    subject,
    html,
    text: `Withdrawal request received for ${currency} ${amount.toFixed(2)}. Request ID: ${withdrawalId}. ${invoiceId ? `Xendit invoice: ${invoiceId}.` : ""}`,
  });
}

async function maybeCreateXenditInvoice(params: {
  withdrawalId: bigint;
  amount: number;
  currency: string;
  method: string;
  userEmail: string;
  userId: number;
}) {
  if (!process.env.XENDIT_SECRET_KEY) return null;

  try {
    const noteParts = [`withdrawal:${params.withdrawalId.toString()}`, `method:${params.method}`];
    const invoice = await createXenditInvoice({
      externalId: `affiliate-withdrawal-${params.withdrawalId.toString()}`,
      amount: params.amount,
      payerEmail: params.userEmail,
      description: `Affiliate payout request for user ${params.userId}`,
      currency: params.currency,
      successRedirectUrl: process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/user/affiliate` : undefined,
      failureRedirectUrl: process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/user/affiliate` : undefined,
      customer: {
        email: params.userEmail,
      },
      metadata: {
        withdrawal_id: params.withdrawalId.toString(),
        affiliate_user_id: params.userId.toString(),
        method: params.method,
        note: noteParts.join("|") as string,
      },
    });

    return invoice.id;
  } catch (err) {
    console.error("[affiliate/withdraw/request] Xendit invoice creation failed:", err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    // ── Rate limit (tight: 5/hour) ─────────────────────────────
    const rl = checkRateLimit("affiliate-withdraw", ip);
    if (!rl.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many withdrawal requests. Please wait before submitting again.",
          },
        },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      );
    }

    // ── Auth ───────────────────────────────────────────────────
    const rawToken = request.cookies.get("session_token")?.value;
    if (!rawToken) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED_ACCESS", message: "Authentication required." } },
        { status: 401 }
      );
    }
    const session = await validateToken(rawToken);
    if (!session) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED_ACCESS", message: "Session expired." } },
        { status: 401 }
      );
    }

    // Payout platform account is not configured yet — block all withdrawal requests.
    if (!WITHDRAWALS_ENABLED) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "WITHDRAWALS_TEMPORARILY_UNAVAILABLE",
            message:
              "Withdrawals are temporarily unavailable while the payout account is being set up. Please message a superadmin if you need help.",
          },
        },
        { status: 503 }
      );
    }

    // ── Affiliate gate ─────────────────────────────────────────
    const settings = await getAffiliateSettings(session.userId);
    if (!settings) {
      return NextResponse.json(
        { success: false, error: { code: "AFFILIATE_NOT_ACTIVE", message: "Affiliate account not found." } },
        { status: 403 }
      );
    }

    // ── Parse and validate body ────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_REQUEST", message: "Invalid JSON body." } },
        { status: 400 }
      );
    }

    const amountRaw = body.amount;
    const method = typeof body.method === "string" ? body.method.trim().toLowerCase() : "";
    const accountDetails =
      body.account_details && typeof body.account_details === "object"
        ? (body.account_details as Record<string, unknown>)
        : {};
    // Validate amount
    if (typeof amountRaw !== "number" || !Number.isFinite(amountRaw) || amountRaw <= 0) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_REQUEST", message: "amount must be a positive number." } },
        { status: 422 }
      );
    }
    // Round to 2 decimal places to prevent floating-point abuse
    const amount = Math.round(amountRaw * 100) / 100;

    // Validate method
    if (!VALID_METHODS.has(method)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_WITHDRAWAL_METHOD",
            message: `Invalid method. Allowed: ${[...VALID_METHODS].join(", ")}.`,
          },
        },
        { status: 422 }
      );
    }

    // ── Balance checks ─────────────────────────────────────────
    const minimumWithdrawal = Number(settings.payment_threshold);

    if (amount < minimumWithdrawal) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "WITHDRAWAL_MINIMUM_NOT_MET",
            message: `Minimum withdrawal amount is $${minimumWithdrawal.toFixed(2)}.`,
            details: { minimum: minimumWithdrawal, requested: amount },
          },
        },
        { status: 422 }
      );
    }

    const availableBalance = await computeAvailableBalance(session.userId);

    if (amount > availableBalance) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INSUFFICIENT_BALANCE",
            message: "Insufficient balance for withdrawal.",
            details: { available: availableBalance, requested: amount, minimum: minimumWithdrawal },
          },
        },
        { status: 422 }
      );
    }

    // ── Idempotency — prevent duplicate submissions within 1 min
    const idempotencyKey = buildWithdrawalIdempotencyKey(session.userId, amount, method);

    const existing = await prisma.withdrawal.findUnique({
      where: { idempotency_key: idempotencyKey },
    });

    if (existing) {
      // Return the existing request (safe idempotent response)
      const estimatedDate = new Date(existing.requested_at);
      estimatedDate.setUTCDate(estimatedDate.getUTCDate() + 5);
      return NextResponse.json(
        serialize({
          success: true,
          withdrawal_id: `wd_${existing.id.toString()}`,
          status: existing.status,
          estimated_processing_date: estimatedDate.toISOString().slice(0, 10),
          message: "Duplicate request detected. Returning existing withdrawal.",
          duplicate: true,
        })
      );
    }

    // ── Encrypt payment details ────────────────────────────────
    let encryptedDetails: string | null = null;
    if (Object.keys(accountDetails).length > 0) {
      // Strip any excessively large values to prevent payload abuse
      const sanitized: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(accountDetails)) {
        if (typeof v === "string" && v.length <= 200) {
          sanitized[k] = v;
        }
      }
      try {
        encryptedDetails = encryptPaymentDetails(sanitized);
      } catch {
        // If encryption key is missing, block the request
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "CONFIGURATION_ERROR",
              message: "Payment details cannot be stored securely. Contact support.",
            },
          },
          { status: 500 }
        );
      }
    }

    // ── Create withdrawal record ───────────────────────────────
    const withdrawal = await prisma.withdrawal.create({
      data: {
        affiliate_user_id: BigInt(session.userId),
        amount: amount,
        currency: "USD",
        status: "requested",
        payment_method: method,
        payment_details: encryptedDetails,
        idempotency_key: idempotencyKey,
      },
    });
    const xenditInvoiceId = await maybeCreateXenditInvoice({
      withdrawalId: withdrawal.id,
      amount,
      currency: "USD",
      method,
      userEmail: session.email ?? "",
      userId: session.userId,
    });

    if (xenditInvoiceId) {
      await prisma.withdrawal.update({
        where: { id: withdrawal.id },
        data: { reference_number: xenditInvoiceId },
      });
    }

    if (session.email) {
      try {
        await sendAffiliateWithdrawalEmails({
          userEmail: session.email,
          amount,
          currency: "USD",
          method,
          withdrawalId: `wd_${withdrawal.id.toString()}`,
          invoiceId: xenditInvoiceId ?? undefined,
          appUrl: process.env.NEXT_PUBLIC_APP_URL || "https://portal.ontap.ph",
        });
      } catch (emailErr) {
        console.error("[affiliate/withdraw/request] failed to send notification email:", emailErr);
      }
    }
    const recentWithdrawalRequests = await prisma.withdrawal.count({
      where: {
        affiliate_user_id: BigInt(session.userId),
        requested_at: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });

    if (recentWithdrawalRequests >= 3) {
      await sendSecurityAlert({
        type: "WITHDRAWAL_BURST",
        severity: "warning",
        userId: session.userId,
        ip,
        metadata: {
          recentWithdrawalRequests,
          windowMinutes: 60,
        },
      });
    }

    // ── Compute estimated processing date (5 business days) ───
    const estimatedDate = new Date();
    estimatedDate.setUTCDate(estimatedDate.getUTCDate() + 5);

    return NextResponse.json(
      serialize({
        success: true,
        withdrawal_id: `wd_${withdrawal.id.toString()}`,
        status: "requested",
        amount,
        currency: "USD",
        estimated_processing_date: estimatedDate.toISOString().slice(0, 10),
        message: "Withdrawal request received successfully.",
      }),
      { status: 201 }
    );
  } catch (err) {
    // Handle unique constraint violation from idempotency key race condition
    if (
      err instanceof Error &&
      err.message.includes("Unique constraint failed")
    ) {
      return NextResponse.json(
        { success: false, error: { code: "DUPLICATE_WITHDRAWAL_REQUEST", message: "Duplicate withdrawal request." } },
        { status: 409 }
      );
    }
    console.error("[affiliate/withdraw/request] error:", err);
    return NextResponse.json(
      { success: false, error: { code: "DATABASE_CONNECTION_ERROR", message: "Internal server error." } },
      { status: 500 }
    );
  }
}
