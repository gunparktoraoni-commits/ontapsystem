// POST /api/marketplace/subscription/change-plan
// Auth required — handles fixed-fee upgrades/downgrades for a specific bizcard.
// Rate limit: 10/hr per IP.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { createPaymentIntent, getDefaultCurrency } from "@/server/lib/payment";
import { processPaymentIdempotently } from "@/lib/payment-idempotency";
import { PaymentErrorCode, toPaymentErrorResponse } from "@/lib/errors/payment-errors";
import { validateChangePlanInput } from "@/server/lib/validators";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

async function requireSession(request: NextRequest) {
  const result = await resolveRequestSession(request);
  if (!result.session) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Authentication required.", requiresAuth: true },
        { status: 401 }
      ),
    };
  }
  return { ok: true as const, session: result.session };
}

// Fixed fee mapping
const UPGRADE_FEES: Record<string, number> = {
  basic_to_standard: 199,
  basic_to_premium: 299,
  standard_to_premium: 199,
};
const DOWNGRADE_FEES: Record<string, number> = {
  premium_to_standard: 199,
  standard_to_basic: 99,
};

function getPlanKey(planName: string | null): string | null {
  if (!planName) return null;
  const name = planName.toLowerCase();
  if (name.includes("basic")) return "basic";
  if (name.includes("standard")) return "standard";
  if (name.includes("premium")) return "premium";
  return null;
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("marketplace-change-plan", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      toPaymentErrorResponse(
        PaymentErrorCode.CHECKOUT_RATE_LIMIT,
        "Too many requests. Please slow down.",
        "unknown",
        { retryAfter: rateCheck.retryAfterMs }
      ),
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (!idempotencyKey || idempotencyKey.length < 10 || idempotencyKey.length > 255) {
    return NextResponse.json(
      toPaymentErrorResponse(
        PaymentErrorCode.IDEMPOTENCY_KEY_INVALID,
        "Valid Idempotency-Key header required (10-255 characters).",
        "unknown"
      ),
      { status: 400 }
    );
  }

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        toPaymentErrorResponse(
          PaymentErrorCode.WEBHOOK_PAYLOAD_INVALID,
          "Invalid JSON body.",
          "unknown"
        ),
        { status: 400 }
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        toPaymentErrorResponse(
          PaymentErrorCode.WEBHOOK_PAYLOAD_INVALID,
          "Invalid request payload.",
          "unknown"
        ),
        { status: 400 }
      );
    }

    const validation = validateChangePlanInput(body as Record<string, unknown>);
    if (!validation.valid) {
      return NextResponse.json(
        toPaymentErrorResponse(
          PaymentErrorCode.CHECKOUT_VALIDATION_FAILED,
          validation.errors[0] ?? "Validation failed.",
          "unknown"
        ),
        { status: 400 }
      );
    }

    // Use type assertion until validator is updated
    const { planId: targetPlanIdStr, action, bizcardSerialId } = validation.data as any;
    const userId = BigInt(session.userId);
    const targetPlanId = BigInt(targetPlanIdStr);

    // Verify bizcard belongs to user
    const bizcard = await prisma.bizcard.findFirst({
      where: { serial_id: bizcardSerialId, user_id: userId, deactivated_flag: false },
    });
    if (!bizcard) {
      return NextResponse.json(
        toPaymentErrorResponse(
          PaymentErrorCode.SUBSCRIPTION_PLAN_INVALID, // Use existing code
          "Bizcard not found or access denied.",
          userId.toString()
        ),
        { status: 404 }
      );
    }

    const result = await processPaymentIdempotently(
      {
        idempotencyKey,
        userId,
        action: "subscription_change_plan",
        payload: { targetPlanId: targetPlanId.toString(), action, bizcardId: bizcard.bizcard_id.toString() },
      },
      async () => {
        // Get current subscription and target plan
        const [currentSub, targetPlan, user] = await Promise.all([
          prisma.bizcardSubscription.findUnique({
            where: { bizcard_id: bizcard.bizcard_id },
            include: { plan: true },
          }),
          prisma.subscriptionPlan.findFirst({
            where: { id: targetPlanId, is_active: true },
          }),
          prisma.user.findUnique({
            where: { user_id: userId },
            select: { email: true, first_name: true, last_name: true },
          }),
        ]);

        if (!targetPlan) {
          throw new Error("Target plan not found or inactive.");
        }
        if (!user) {
          throw new Error("User not found.");
        }

        if (!currentSub || currentSub.status !== "active") {
          // No active subscription – treat as new purchase (full monthly price)
          const fullPrice = Number(targetPlan.price_monthly ?? 0);
          if (fullPrice <= 0) {
            // Free plan – activate directly
            const now = new Date();
            const periodEnd = new Date(now);
            periodEnd.setMonth(periodEnd.getMonth() + 1);
            await prisma.bizcardSubscription.upsert({
              where: { bizcard_id: bizcard.bizcard_id },
              update: {
                plan_id: targetPlanId,
                status: "active",
                started_at: now,
                expires_at: periodEnd,
                auto_renew: true,
              },
              create: {
                bizcard_id: bizcard.bizcard_id,
                plan_id: targetPlanId,
                status: "active",
                billing_cycle: "monthly",
                started_at: now,
                expires_at: periodEnd,
                auto_renew: true,
              },
            });
            // Also update Bizcard table
            await prisma.bizcard.update({
              where: { bizcard_id: bizcard.bizcard_id },
              data: {
                subscription_tier: targetPlan.tier_code,
                subscription_started_at: now,
                subscription_expires_at: periodEnd,
                subscription_status: "active",
              },
            });
            return { requiresPayment: false, invoiceUrl: null, message: "Subscription activated." };
          }
          // Paid plan – create invoice for full monthly price
          const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "";
          const successRedirectUrl = `${appUrl}/payment/success?session_id=plan_change_${Date.now()}`;
          const failureRedirectUrl = `${appUrl}/payment/failure?session_id=plan_change_${Date.now()}`;

          const invoice = await createPaymentIntent(fullPrice, getDefaultCurrency(), {
            userId: userId.toString(),
            payerEmail: user.email,
            customerName: `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || "Customer",
            description: `${targetPlan.name} (${action})`,
            successRedirectUrl,
            failureRedirectUrl,
            items: [{ name: targetPlan.name, quantity: 1, price: fullPrice, category: "subscription" }],
            metadata: { source: "subscription_change_plan", userId: userId.toString(), planId: targetPlanId.toString(), action, bizcardId: bizcard.bizcard_id.toString() },
          });

          if (!invoice) {
            throw new Error("Failed to create payment invoice.");
          }

          // Store pending change in upgrade log
          await prisma.subscriptionUpgradeLog.create({
            data: {
              bizcard_id: bizcard.bizcard_id,
              from_plan_id: currentSub?.plan_id ?? null,
              to_plan_id: targetPlanId,
              upgrade_type: "plan_change_pending",
              billing_cycle: "monthly",
              amount_paid: fullPrice,
              effective_date: new Date(),
            },
          });

          return { requiresPayment: true, invoiceUrl: invoice.clientSecret, message: "Complete payment to change plan." };
        }

        // Existing active subscription – determine fixed fee
        const currentPlanKey = getPlanKey(currentSub.plan.name);
        const targetPlanKey = getPlanKey(targetPlan.name);
        if (!currentPlanKey || !targetPlanKey) {
          throw new Error("Unable to determine plan levels.");
        }

        let fee: number | null = null;
        if (action === "upgrade") {
          const key = `${currentPlanKey}_to_${targetPlanKey}`;
          fee = UPGRADE_FEES[key] ?? null;
          if (!fee) throw new Error("Invalid upgrade path or no fixed fee defined.");
        } else {
          // Downgrade – must check that current plan has expired
          const now = new Date();
          const expiryDate = new Date(currentSub.expires_at);
          if (expiryDate > now) {
            throw new Error("Cannot downgrade before current plan expires. Your plan ends on " + expiryDate.toISOString());
          }
          const key = `${currentPlanKey}_to_${targetPlanKey}`;
          fee = DOWNGRADE_FEES[key] ?? null;
          if (!fee) throw new Error("Invalid downgrade path or no fixed fee defined.");
        }

        if (fee === null || fee <= 0) {
          throw new Error("Invalid fee amount for plan change.");
        }

        // Create Xendit invoice for fixed fee
        const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "";
        const successRedirectUrl = `${appUrl}/payment/success?session_id=plan_change_${Date.now()}`;
        const failureRedirectUrl = `${appUrl}/payment/failure?session_id=plan_change_${Date.now()}`;

        const invoice = await createPaymentIntent(fee, getDefaultCurrency(), {
          userId: userId.toString(),
          payerEmail: user.email,
          customerName: `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || "Customer",
          description: `${action} to ${targetPlan.name} (fee ₱${fee})`,
          successRedirectUrl,
          failureRedirectUrl,
          items: [{ name: `${action} to ${targetPlan.name}`, quantity: 1, price: fee, category: "subscription_change" }],
          metadata: { source: "subscription_change_plan", userId: userId.toString(), planId: targetPlanId.toString(), action, fee: String(fee), bizcardId: bizcard.bizcard_id.toString() },
        });

        if (!invoice) {
          throw new Error("Failed to create payment invoice.");
        }

        // Store pending change
        await prisma.subscriptionUpgradeLog.create({
          data: {
            bizcard_id: bizcard.bizcard_id,
            from_plan_id: currentSub.plan_id,
            to_plan_id: targetPlanId,
            upgrade_type: "plan_change_pending",
            billing_cycle: currentSub.billing_cycle,
            amount_paid: fee,
            effective_date: new Date(),
          },
        });

        return { requiresPayment: true, invoiceUrl: invoice.clientSecret, message: "Complete payment to change plan." };
      }
    );

    if (result.duplicate) {
      return NextResponse.json(
        toPaymentErrorResponse(
          PaymentErrorCode.DUPLICATE_PAYMENT_REQUEST,
          "This request has already been processed.",
          session.userId.toString()
        ),
        { status: 409 }
      );
    }

    const { requiresPayment, invoiceUrl, message } = result.result as any;
    return NextResponse.json(serialize({
      success: true,
      data: {
        requiresPayment,
        invoiceUrl: invoiceUrl || null,
      },
      message,
    }), { status: 200 });
  } catch (err) {
    console.error("[marketplace/subscription/change-plan POST]", err);
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    let errorCode = PaymentErrorCode.INVOICE_CREATION_FAILED;
    let status = 500;
    if (message.includes("Cannot downgrade") || message.includes("expired")) {
      errorCode = PaymentErrorCode.SUBSCRIPTION_DOWNGRADE_NOT_ALLOWED;
      status = 409;
    } else if (message.includes("Invalid upgrade path")) {
      errorCode = PaymentErrorCode.SUBSCRIPTION_PLAN_INVALID;
      status = 400;
    } else if (message.includes("Bizcard not found")) {
      errorCode = PaymentErrorCode.SUBSCRIPTION_PLAN_INVALID;
      status = 404;
    }
    return NextResponse.json(
      toPaymentErrorResponse(errorCode, message, session?.userId?.toString() ?? "unknown"),
      { status }
    );
  }
}