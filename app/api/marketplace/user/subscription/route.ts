// GET /api/marketplace/user/subscription
// Auth required — returns the subscription for the user's first active bizcard (for backward compatibility).
// Rate limit: 60/min per IP.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

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

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("marketplace-user-subscription", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const { session } = auth;

  try {
    const userId = BigInt(session.userId);

    // Get the user's first active bizcard
    const firstBizcard = await prisma.bizcard.findFirst({
      where: { user_id: userId, deactivated_flag: false },
      orderBy: { created_at: "asc" },
      select: { bizcard_id: true },
    });

    if (!firstBizcard) {
      return NextResponse.json(serialize({
        success: true,
        data: { subscription: null },
      }));
    }

    const subscription = await prisma.bizcardSubscription.findUnique({
      where: { bizcard_id: firstBizcard.bizcard_id },
      include: { plan: true },
    });

    if (!subscription) {
      return NextResponse.json(serialize({
        success: true,
        data: { subscription: null },
      }));
    }

    // Gather usage stats — template downloads + orders this billing period
    const periodStart = subscription.started_at;
    const periodEnd = subscription.expires_at;

    const [templateDownloads, ordersThisPeriod, upgradeLogs] = await Promise.all([
      prisma.templatePurchase.count({
        where: {
          user_id: userId,
          purchased_at: { gte: periodStart, lte: periodEnd },
        },
      }),
      prisma.shopOrder.count({
        where: {
          user_id: userId,
          placed_at: { gte: periodStart, lte: periodEnd },
        },
      }),
      prisma.subscriptionUpgradeLog.findMany({
        where: { bizcard_id: firstBizcard.bizcard_id },
        orderBy: { effective_date: "desc" },
        take: 5,
      }),
    ]);

    return NextResponse.json(serialize({
      success: true,
      data: {
        subscription: {
          id: subscription.id.toString(),
          status: subscription.status,
          billingCycle: subscription.billing_cycle,
          plan: {
            id: subscription.plan.id.toString(),
            name: subscription.plan.name,
            monthlyPrice: Number(subscription.plan.price_monthly ?? 0),
            yearlyPrice: Number(subscription.plan.price_yearly ?? 0),
            features: subscription.plan.features,
          },
          startedAt: subscription.started_at,
          expiresAt: subscription.expires_at,
          autoRenew: subscription.auto_renew,
          cancelReason: subscription.cancel_reason ?? null,
          cancelFeedback: subscription.cancel_feedback ?? null,
          downgradePlanId: subscription.downgrade_plan_id?.toString() ?? null,
          xenditCustomerId: subscription.xendit_customer_id ?? null,
          xenditSubscriptionId: subscription.xendit_subscription_id ?? null,
          usage: {
            templateDownloadsThisPeriod: templateDownloads,
            ordersThisPeriod,
          },
          upgradeLogs: upgradeLogs.map((l) => ({
            id: l.id.toString(),
            fromPlanId: l.from_plan_id?.toString() ?? null,
            toPlanId: l.to_plan_id.toString(),
            upgradeType: l.upgrade_type,
            amountPaid: Number(l.amount_paid ?? 0),
            effectiveDate: l.effective_date,
          })),
        },
      },
    }));
  } catch (err) {
    console.error("[marketplace/user/subscription GET]", err);
    return NextResponse.json({ success: false, error: "An unexpected error occurred." }, { status: 500 });
  }
}