import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("marketplace-plans-list", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  try {
    // Optional auth
    let userId: bigint | null = null;
    const authHeader = request.headers.get("authorization");
    const rawToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (rawToken) {
      const payload = await validateToken(rawToken);
      if (payload?.userId) userId = BigInt(payload.userId);
    }

    const { searchParams } = new URL(request.url);
    const bizcardSerialId = searchParams.get("bizcardSerialId");

    let currentPlanId: string | null = null;
    if (userId && bizcardSerialId) {
      const bizcard = await prisma.bizcard.findFirst({
        where: { serial_id: bizcardSerialId, user_id: userId, deactivated_flag: false },
      });
      if (bizcard) {
        const subscription = await prisma.bizcardSubscription.findUnique({
          where: { bizcard_id: bizcard.bizcard_id },
          select: { plan_id: true },
        });
        if (subscription) currentPlanId = subscription.plan_id.toString();
      }
    } else if (userId && !bizcardSerialId) {
      // Fallback: get first active bizcard's subscription (optional)
      const firstBizcard = await prisma.bizcard.findFirst({
        where: { user_id: userId, deactivated_flag: false },
        orderBy: { created_at: "asc" },
      });
      if (firstBizcard) {
        const subscription = await prisma.bizcardSubscription.findUnique({
          where: { bizcard_id: firstBizcard.bizcard_id },
          select: { plan_id: true },
        });
        if (subscription) currentPlanId = subscription.plan_id.toString();
      }
    }

    const plans = await prisma.subscriptionPlan.findMany({
      where: { is_active: true },
      orderBy: [{ display_order: "asc" }, { price_monthly: "asc" }],
    });

    return NextResponse.json(serialize({
      success: true,
      data: {
        plans: plans.map((p) => ({
          id: p.id.toString(),
          name: p.name,
          description: p.description,
          monthlyPrice: Number(p.price_monthly ?? 0),
          yearlyPrice: Number(p.price_yearly ?? 0),
          features: p.features,
          isCurrent: currentPlanId === p.id.toString(),
        })),
        currentSubscription: currentPlanId ? { planId: currentPlanId } : null,
      },
    }));
  } catch (err) {
    console.error("[marketplace/subscriptions/plans GET]", err);
    return NextResponse.json({ success: false, error: "An unexpected error occurred." }, { status: 500 });
  }
}