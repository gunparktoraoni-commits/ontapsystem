import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { validateSubscriptionDowngradeInput } from "@/server/lib/validators";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

async function requireSession(request: NextRequest) {
  const result = await resolveRequestSession(request);
  if (!result.session) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Authentication required." }, { status: 401 }),
    };
  }
  return { ok: true as const, session: result.session };
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("marketplace-sub-downgrade", ip);
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
    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
    }

    const validation = validateSubscriptionDowngradeInput(body as Record<string, unknown>);
    if (!validation.valid) {
      return NextResponse.json({ success: false, error: validation.errors[0] ?? "Validation failed." }, { status: 400 });
    }

    // Use type assertion until validator is updated
    const { planId, bizcardSerialId } = validation.data as any;
    const userId = BigInt(session.userId);
    const targetPlanId = BigInt(planId);

    // Verify bizcard belongs to user
    const bizcard = await prisma.bizcard.findFirst({
      where: { serial_id: bizcardSerialId, user_id: userId, deactivated_flag: false },
    });
    if (!bizcard) {
      return NextResponse.json({ success: false, error: "Bizcard not found." }, { status: 404 });
    }

    const existingSub = await prisma.bizcardSubscription.findUnique({
      where: { bizcard_id: bizcard.bizcard_id },
      include: { plan: true },
    });
    if (!existingSub || existingSub.status !== "active") {
      return NextResponse.json({ success: false, error: "No active subscription found for this bizcard." }, { status: 404 });
    }

    const targetPlan = await prisma.subscriptionPlan.findFirst({
      where: { id: targetPlanId, is_active: true },
    });
    if (!targetPlan) return NextResponse.json({ success: false, error: "Target plan not found." }, { status: 404 });

    const currentMonthly = Number(existingSub.plan.price_monthly ?? 0);
    const targetMonthly = Number(targetPlan.price_monthly ?? 0);
    if (targetMonthly >= currentMonthly) {
      return NextResponse.json({ success: false, error: "Target plan is not a downgrade." }, { status: 400 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const sub = await tx.bizcardSubscription.update({
        where: { bizcard_id: bizcard.bizcard_id },
        data: { downgrade_plan_id: targetPlanId },
      });
      await tx.subscriptionUpgradeLog.create({
        data: {
          bizcard_id: bizcard.bizcard_id,
          from_plan_id: existingSub.plan_id,
          to_plan_id: targetPlanId,
          upgrade_type: "downgrade_scheduled",
          billing_cycle: existingSub.billing_cycle,
          amount_paid: 0,
          effective_date: existingSub.expires_at,
        },
      });
      return sub;
    });

    return NextResponse.json(serialize({
      success: true,
      data: {
        subscription: {
          id: updated.id.toString(),
          currentPlanId: existingSub.plan_id.toString(),
          scheduledDowngradePlanId: targetPlanId.toString(),
          scheduledDowngradePlanName: targetPlan.name,
          effectiveDate: existingSub.expires_at,
        },
      },
      message: `Downgrade to "${targetPlan.name}" scheduled. Your current plan remains active until ${existingSub.expires_at.toISOString()}.`,
    }));
  } catch (err) {
    console.error("[marketplace/subscription/downgrade POST]", err);
    return NextResponse.json({ success: false, error: "An unexpected error occurred." }, { status: 500 });
  }
}