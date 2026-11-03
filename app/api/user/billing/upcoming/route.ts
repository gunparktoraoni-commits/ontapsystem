// app/api/user/billing/upcoming/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

function serialize(obj: unknown): unknown {
  return JSON.parse(JSON.stringify(obj, (_, value) => (typeof value === "bigint" ? value.toString() : value)));
}

function fmt(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
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
    include: { plan: true },
  });

  if (!subscription) {
    return NextResponse.json({ success: true, data: null });
  }

  const amount = Number(subscription.billing_cycle === "yearly" ? subscription.plan.price_yearly ?? 0 : subscription.plan.price_monthly ?? 0);
  const now = new Date();
  const daysUntil = Math.max(0, Math.ceil((subscription.expires_at.getTime() - now.getTime()) / 86_400_000));

  return NextResponse.json(
    serialize({
      success: true,
      data: {
        next_billing_date: subscription.expires_at,
        next_billing_amount: amount,
        next_billing_currency: "USD",
        next_billing_formatted: fmt(amount, "USD"),
        payment_method: {
          type: subscription.payment_method_id ? "tokenized" : "unknown",
          brand: null,
          last4: null,
        },
        items: [
          {
            description: `${subscription.plan.name} Plan - ${subscription.billing_cycle}`,
            amount,
            quantity: 1,
          },
        ],
        days_until_billing: daysUntil,
        can_change_payment: true,
        can_skip: false,
      },
    })
  );
}