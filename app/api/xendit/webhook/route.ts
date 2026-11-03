// app/api/xendit/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp } from "@/server/lib/auth";
import { verifyXenditWebhookToken } from "@/server/lib/xendit";
import { processWebhookOnce } from "@/lib/webhook-idempotency";
import {
  PaymentErrorCode,
  toPaymentErrorResponse,
} from "@/lib/errors/payment-errors";
import {
  XENDIT_FAILURE_STATUSES,
  XENDIT_SUCCESS_STATUSES,
  failShopOrderPayment,
  fulfillPaidShopOrder,
  markShopOrderAmountMismatch,
  xenditAmountsMatch,
} from "@/server/lib/marketplace/order-fulfillment";
import { tryQualifyReferral } from "@/server/lib/growth-referral";

interface XenditWebhookPayload {
  id?: string;
  external_id?: string;
  status?: string;
  amount?: number;
  paid_amount?: number;
  paid_at?: string;
  payment_method?: string;
  currency?: string;
  metadata?: Record<string, string>;
}

const serialize = (obj: unknown): unknown =>
  JSON.parse(
    JSON.stringify(obj, (_, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );

function normalizeStatus(status: string | undefined): string {
  return (status ?? "").trim().toUpperCase();
}

async function activatePendingPlanChange(invoiceId: string, paidAt?: string) {
  const pendingSub = await prisma.bizcardSubscription.findFirst({
    where: {
      xendit_invoice_id: invoiceId,
      status: "pending",
    },
    include: {
      bizcard: true,
      plan: true,
    },
  });

  if (!pendingSub) return false;

  const now = new Date();
  const periodEnd = new Date(now);
  if (pendingSub.billing_cycle === "yearly") {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }

  await prisma.$transaction(async (tx) => {
    await tx.bizcardSubscription.update({
      where: { id: pendingSub.id },
      data: {
        status: "active",
        started_at: paidAt ? new Date(paidAt) : now,
        expires_at: periodEnd,
        auto_renew: true,
        downgrade_plan_id: null,
        xendit_invoice_id: null,
      },
    });

    await tx.bizcard.update({
      where: { bizcard_id: pendingSub.bizcard_id },
      data: {
        subscription_tier: pendingSub.plan.tier_code,
        subscription_started_at: paidAt ? new Date(paidAt) : now,
        subscription_expires_at: periodEnd,
        subscription_status: "active",
      },
    });

    await tx.subscriptionUpgradeLog.updateMany({
      where: {
        bizcard_id: pendingSub.bizcard_id,
        to_plan_id: pendingSub.plan_id,
        upgrade_type: "plan_change_pending",
      },
      data: {
        upgrade_type: "plan_change_completed",
        effective_date: now,
        expiry_date: periodEnd,
      },
    });
  });

  const referredUserId = pendingSub.bizcard.user_id;
  if (referredUserId != null) {
    try {
      await tryQualifyReferral({
        referredUserId,
        source: "subscription",
      });
    } catch (error) {
      console.warn("[xendit-webhook] Failed to qualify growth referral after plan change", {
        bizcardId: pendingSub.bizcard_id.toString(),
        error,
      });
    }
  }

  return true;
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("xendit-webhook", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      toPaymentErrorResponse(
        PaymentErrorCode.WEBHOOK_RATE_LIMIT,
        "Too many webhook requests",
        "unknown",
      ),
      { status: 429 },
    );
  }

  const callbackToken = request.headers.get("x-callback-token");
  if (!verifyXenditWebhookToken(callbackToken)) {
    return NextResponse.json(
      toPaymentErrorResponse(
        PaymentErrorCode.WEBHOOK_SIGNATURE_INVALID,
        "Invalid webhook signature",
        "unknown",
      ),
      { status: 401 },
    );
  }

  const payload = (await request
    .json()
    .catch(() => ({}))) as XenditWebhookPayload;
  const eventId = payload.id?.trim();
  const externalId = payload.external_id?.trim();
  const status = normalizeStatus(payload.status);

  if (!eventId || !externalId || !status) {
    return NextResponse.json(
      { received: true, ignored: "invalid_webhook_payload" },
      { status: 200 },
    );
  }

  const result = await processWebhookOnce(
    {
      provider: "xendit",
      eventId,
      eventType: status,
      idempotencyKey: `${externalId}:${eventId}`,
      metadata: {
        externalId,
        amount: payload.amount,
        paid_amount: payload.paid_amount,
        payment_method: payload.payment_method,
      },
    },
    async () => {
      const isSubscriptionUpgrade =
        payload.metadata?.source === "subscription_upgrade" ||
        externalId.startsWith("SUB-UPG-") ||
        externalId.startsWith("plan_change_");

      if (isSubscriptionUpgrade && XENDIT_SUCCESS_STATUSES.has(status)) {
        const activated = await activatePendingPlanChange(
          eventId,
          payload.paid_at,
        );
        if (activated) {
          return { processed: true, type: "subscription_activation" };
        }
      }

      const order = await prisma.shopOrder.findUnique({
        where: { order_number: externalId },
        select: { id: true, total_amount: true, status: true },
      });

      if (!order) {
        return { ignored: "order_not_found" };
      }

      const expectedAmount = Number(order.total_amount);
      const receivedAmount = Number(payload.paid_amount ?? payload.amount ?? 0);

      if (XENDIT_SUCCESS_STATUSES.has(status)) {
        if (!xenditAmountsMatch(receivedAmount, expectedAmount)) {
          await markShopOrderAmountMismatch(order.id);
          return { ignored: "amount_mismatch" };
        }

        await fulfillPaidShopOrder(order.id, {
          xenditInvoiceId: eventId,
          status,
          paidAt: payload.paid_at,
          paymentMethod: payload.payment_method ?? null,
        });
        return { processed: true };
      }

      if (XENDIT_FAILURE_STATUSES.has(status)) {
        await failShopOrderPayment(order.id, status);
        return { processed: true };
      }

      if (status === "PENDING") {
        await prisma.shopOrder.update({
          where: { id: order.id },
          data: { xendit_status: status },
        });
        return { processed: true };
      }

      await prisma.shopOrder.update({
        where: { id: order.id },
        data: { xendit_status: status },
      });
      return { processed: true };
    },
  );

  if (result.duplicate) {
    return NextResponse.json(
      serialize({
        received: true,
        duplicate: true,
        message: "Duplicate webhook event ignored.",
      }),
    );
  }

  return NextResponse.json(serialize({ received: true, processed: true }));
}
