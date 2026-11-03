import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

function serialize(obj: unknown): unknown {
  return JSON.parse(JSON.stringify(obj, (_, value) => (typeof value === "bigint" ? value.toString() : value)));
}

async function requireSession(request: NextRequest) {
  const resolved = await resolveRequestSession(request);
  if (!resolved.session) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Authentication required.", requiresAuth: true }, { status: 401 }),
    };
  }
  return { ok: true as const, session: resolved.session };
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = checkRateLimit("marketplace-user-subscription", ip);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429 });
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const userId = BigInt(auth.session.userId);

  const subscription = await prisma.bizcardSubscription.findFirst({
    where: {
      bizcard: { user_id: userId, deactivated_flag: false },
      status: "active",
    },
    include: { plan: true, bizcard: true },
  });

  if (!subscription) {
    return NextResponse.json({ success: true, data: null });
  }

  const plan = subscription.plan;
  const [templatesUsed, productsUsed, orders] = await Promise.all([
    prisma.templatePurchase.count({ where: { user_id: userId } }),
    prisma.product.count({ where: { user_id: userId } }),
    prisma.shopOrder.count({ where: { user_id: userId } }),
  ]);

  const nextBillingDate = subscription.expires_at;
  const nextBillingAmount = Number(subscription.billing_cycle === "yearly" ? plan.price_yearly ?? 0 : plan.price_monthly ?? 0);

  return NextResponse.json(serialize({
    success: true,
    data: {
      plan: {
        id: plan.id,
        name: plan.name,
        description: plan.description,
        features: plan.features,
        price_monthly: Number(plan.price_monthly ?? 0),
        price_yearly: Number(plan.price_yearly ?? 0),
        currency: "USD",
        is_active: plan.is_active,
      },
      subscription: {
        id: subscription.id,
        status: subscription.status,
        billing_cycle: subscription.billing_cycle,
        started_at: subscription.started_at,
        current_period_start: subscription.started_at,
        current_period_end: subscription.expires_at,
        cancel_at_period_end: !subscription.auto_renew,
        next_billing_date: nextBillingDate,
        next_billing_amount: nextBillingAmount,
      },
      usage: {
        templates_used: templatesUsed,
        templates_limit: plan.max_templates,
        products_used: productsUsed,
        products_limit: plan.max_products,
        storage_used: null,
        storage_limit: null,
        team_members: orders,
        team_limit: null,
      },
      actions: {
        can_upgrade: true,
        can_downgrade: true,
        can_cancel: true,
        available_plans: [],
      },
    },
  }));
}