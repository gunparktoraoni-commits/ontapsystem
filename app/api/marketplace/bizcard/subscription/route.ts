// app/api/marketplace/bizcard/subscription/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("marketplace-bizcard-subscription", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const auth = await resolveRequestSession(request);
  if (!auth.session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const userId = BigInt(auth.session.userId);
  const { searchParams } = new URL(request.url);
  const serialId = searchParams.get("serialId");
  if (!serialId) {
    return NextResponse.json({ error: "Missing serialId" }, { status: 400 });
  }

  const bizcard = await prisma.bizcard.findFirst({
    where: { serial_id: serialId, user_id: userId, deactivated_flag: false },
  });
  if (!bizcard) {
    return NextResponse.json({ error: "Bizcard not found" }, { status: 404 });
  }

  const subscription = await prisma.bizcardSubscription.findUnique({
    where: { bizcard_id: bizcard.bizcard_id },
    include: { plan: true },
  });

  if (!subscription) {
    return NextResponse.json({ success: true, data: { subscription: null } });
  }

  // gather usage stats for this bizcard
  const [templateDownloads, ordersThisPeriod] = await Promise.all([
    prisma.templatePurchase.count({
      where: {
        user_id: userId,
        purchased_at: { gte: subscription.started_at, lte: subscription.expires_at },
      },
    }),
    prisma.shopOrder.count({
      where: {
        user_id: userId,
        placed_at: { gte: subscription.started_at, lte: subscription.expires_at },
      },
    }),
  ]);

  return NextResponse.json({
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
        cancelReason: subscription.cancel_reason,
        cancelFeedback: subscription.cancel_feedback,
        downgradePlanId: subscription.downgrade_plan_id?.toString() ?? null,
        xenditCustomerId: subscription.xendit_customer_id,
        xenditSubscriptionId: subscription.xendit_subscription_id,
        usage: {
          templateDownloadsThisPeriod: templateDownloads,
          ordersThisPeriod,
        },
      },
    },
  });
}