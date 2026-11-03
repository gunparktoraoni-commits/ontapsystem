// app/api/marketplace/subscriptions/upgrade/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { createPaymentIntent, calculateProration, getDefaultCurrency } from "@/server/lib/payment";
import { sendSubscriptionConfirmationEmail } from "@/server/lib/email";
import { processPaymentIdempotently } from "@/lib/payment-idempotency";
import { PaymentErrorCode, toPaymentErrorResponse } from "@/lib/errors/payment-errors";

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

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("marketplace-sub-upgrade", ip);
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

    // Extend validation to include bizcardSerialId
    const { planId, billingCycle, prorate = true, bizcardSerialId } = body as any;
    if (!bizcardSerialId) {
      return NextResponse.json(
        toPaymentErrorResponse(
          PaymentErrorCode.CHECKOUT_VALIDATION_FAILED,
          "bizcardSerialId is required.",
          "unknown"
        ),
        { status: 400 }
      );
    }

    const userId = BigInt(session.userId);

    // Verify bizcard belongs to user
    const bizcard = await prisma.bizcard.findFirst({
      where: { serial_id: bizcardSerialId, user_id: userId, deactivated_flag: false },
    });
    if (!bizcard) {
      return NextResponse.json(
        toPaymentErrorResponse(
          PaymentErrorCode.SUBSCRIPTION_PLAN_INVALID,
          "Bizcard not found or access denied.",
          userId.toString()
        ),
        { status: 404 }
      );
    }

    try {
      const result = await processPaymentIdempotently(
        {
          idempotencyKey,
          userId,
          action: "subscription_upgrade",
          payload: { planId, billingCycle, prorate, bizcardId: bizcard.bizcard_id.toString() },
        },
        async () => {
          const targetPlanId = BigInt(planId);

          const targetPlan = await prisma.subscriptionPlan.findFirst({
            where: { id: targetPlanId, is_active: true },
          });
          if (!targetPlan) {
            throw new Error("Plan not found or no longer available.");
          }

          // Fetch existing subscription for this bizcard
          const existingSub = await prisma.bizcardSubscription.findUnique({
            where: { bizcard_id: bizcard.bizcard_id },
            include: { plan: true },
          });

          const user = await prisma.user.findUnique({
            where: { user_id: userId },
            select: { user_id: true, email: true, first_name: true, last_name: true },
          });
          if (!user) {
            throw new Error("User not found.");
          }

          // Prevent re-subscribing to the same plan
          if (existingSub && existingSub.plan_id === targetPlanId && existingSub.status === "active") {
            throw new Error("This bizcard is already subscribed to this plan.");
          }

          const now = new Date();
          const planPrice = billingCycle === "yearly"
            ? Number(targetPlan.price_yearly ?? 0)
            : Number(targetPlan.price_monthly ?? 0);

          let prorationAmount = 0;
          let chargeAmount = planPrice;
          if (prorate && existingSub?.started_at && existingSub?.expires_at) {
            prorationAmount = calculateProration(
              Number(existingSub.plan.price_monthly ?? 0),
              existingSub.billing_cycle as "monthly" | "yearly",
              existingSub.started_at,
              existingSub.expires_at
            );
            chargeAmount = Math.max(0, planPrice - prorationAmount);
          }

          const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "";
          const successRedirectUrl = `${appUrl}/dashboard/subscription/success`;
          const failureRedirectUrl = `${appUrl}/dashboard/subscription/failed`;

          let xenditInvoiceId: string | null = null;
          let xenditInvoiceUrl: string | null = null;

          if (chargeAmount > 0 && planPrice > 0) {
            const orderNumber = `SUB-UPG-${userId}-${Date.now()}`;

            const pi = await createPaymentIntent(chargeAmount, getDefaultCurrency(), {
              userId: userId.toString(),
              orderNumber,
              payerEmail: user.email,
              customerName: `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || "Customer",
              description: `${targetPlan.name} - ${billingCycle} subscription upgrade`,
              successRedirectUrl,
              failureRedirectUrl,
              items: [
                {
                  name: `${targetPlan.name} (${billingCycle})`,
                  quantity: 1,
                  price: chargeAmount,
                  category: "subscription",
                },
              ],
              metadata: {
                source: "subscription_upgrade",
                userId: userId.toString(),
                planId: targetPlanId.toString(),
                billingCycle,
                orderNumber,
                bizcardId: bizcard.bizcard_id.toString(),
              },
            });

            if (!pi) {
              throw new Error("Payment gateway not configured. Please contact support.");
            }
            xenditInvoiceId = pi.id;
            xenditInvoiceUrl = pi.clientSecret;
          }

          const periodStart = now;
          const periodEnd = new Date(now);
          if (billingCycle === "yearly") {
            periodEnd.setFullYear(periodEnd.getFullYear() + 1);
          } else {
            periodEnd.setMonth(periodEnd.getMonth() + 1);
          }

          const fromPlanId = existingSub?.plan_id ?? null;
          const newSub = await prisma.$transaction(async (tx) => {
            const sub = await tx.bizcardSubscription.upsert({
              where: { bizcard_id: bizcard.bizcard_id },
              update: {
                plan_id: targetPlanId,
                status: chargeAmount > 0 ? "pending" : "active",
                billing_cycle: billingCycle,
                started_at: periodStart,
                expires_at: periodEnd,
                auto_renew: true,
                downgrade_plan_id: null,
                xendit_invoice_id: xenditInvoiceId,
              },
              create: {
                bizcard_id: bizcard.bizcard_id,
                plan_id: targetPlanId,
                status: chargeAmount > 0 ? "pending" : "active",
                billing_cycle: billingCycle,
                started_at: periodStart,
                expires_at: periodEnd,
                auto_renew: true,
                xendit_invoice_id: xenditInvoiceId,
              },
            });

            // Update bizcard denormalized
            await tx.bizcard.update({
              where: { bizcard_id: bizcard.bizcard_id },
              data: {
                subscription_tier: targetPlan.tier_code,
                subscription_started_at: periodStart,
                subscription_expires_at: periodEnd,
                subscription_status: chargeAmount > 0 ? "pending_activation" : "active",
              },
            });

            await tx.subscriptionUpgradeLog.create({
              data: {
                bizcard_id: bizcard.bizcard_id,
                from_plan_id: fromPlanId,
                to_plan_id: targetPlanId,
                upgrade_type: fromPlanId ? "upgrade" : "new",
                billing_cycle: billingCycle,
                amount_paid: chargeAmount,
                effective_date: periodStart,
                expiry_date: periodEnd,
              },
            });

            return sub;
          });

          // Send confirmation email
          sendSubscriptionConfirmationEmail(user.email, {
            customerName: user.first_name ?? "Customer",
            planName: targetPlan.name,
            billingCycle,
            amount: chargeAmount,
            currency: getDefaultCurrency(),
            expiresAt: periodEnd,
            isUpgrade: fromPlanId !== null,
          }).catch((e) => console.error("[sub upgrade email]", e));

          return {
            subscription: newSub,
            targetPlan,
            user,
            fromPlanId,
            periodStart,
            periodEnd,
            chargeAmount,
            prorationAmount,
            xenditInvoiceId,
            xenditInvoiceUrl,
          };
        }
      );

      if (result.duplicate) {
        return NextResponse.json(
          toPaymentErrorResponse(
            PaymentErrorCode.DUPLICATE_PAYMENT_REQUEST,
            "This request has already been processed",
            userId.toString()
          ),
          { status: 409 }
        );
      }

      const { subscription: newSub, targetPlan, chargeAmount, xenditInvoiceId, xenditInvoiceUrl } = result.result!;

      return NextResponse.json({
        success: true,
        data: {
          subscription: {
            id: newSub.id.toString(),
            planId: targetPlan.id.toString(),
            planName: targetPlan.name,
            status: newSub.status,
            billingCycle,
            chargeAmount,
            xenditInvoiceId,
            xenditInvoiceUrl,
            requiresPayment: chargeAmount > 0,
          },
        },
        message: chargeAmount > 0 ? "Payment required to complete upgrade." : "Subscription upgraded successfully.",
      }, { status: 200 });
    } catch (err) {
      console.error("[marketplace/subscription/upgrade POST]", err);
      const message = err instanceof Error ? err.message : "An unexpected error occurred.";
      let errorCode = PaymentErrorCode.INVOICE_CREATION_FAILED;
      let status = 500;
      if (message.includes("Plan not found")) {
        errorCode = PaymentErrorCode.SUBSCRIPTION_PLAN_INVALID;
        status = 404;
      } else if (message.includes("already subscribed")) {
        errorCode = PaymentErrorCode.DUPLICATE_PAYMENT_REQUEST;
        status = 409;
      } else if (message.includes("Payment gateway not configured")) {
        errorCode = PaymentErrorCode.INVOICE_CREATION_FAILED;
        status = 503;
      }
      return NextResponse.json(
        toPaymentErrorResponse(errorCode, message, "unknown", { reason: message }),
        { status }
      );
    }
  } catch (err) {
    console.error("[marketplace/subscription/upgrade POST] Outer catch:", err);
    return NextResponse.json(
      toPaymentErrorResponse(
        PaymentErrorCode.INVOICE_CREATION_FAILED,
        "An unexpected error occurred",
        "unknown"
      ),
      { status: 500 }
    );
  }
}