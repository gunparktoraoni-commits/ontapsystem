import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp, logAuditEvent } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { validateCancelImmediateInput } from "@/server/lib/validators";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

async function requireSession(request: NextRequest) {
  const result = await resolveRequestSession(request);
  if (!result.session) {
    return { ok: false as const, response: NextResponse.json({ error: "Authentication required." }, { status: 401 }) };
  }
  return { ok: true as const, session: result.session };
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("marketplace-sub-cancel-immediate", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
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

    const validation = validateCancelImmediateInput(body as Record<string, unknown>);
    if (!validation.valid) {
      return NextResponse.json({ success: false, error: validation.errors[0] ?? "Validation failed." }, { status: 400 });
    }

    const { bizcardSerialId } = validation.data!;
    const userId = BigInt(session.userId);

    const bizcard = await prisma.bizcard.findFirst({
      where: { serial_id: bizcardSerialId, user_id: userId },
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

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const sub = await tx.bizcardSubscription.update({
        where: { bizcard_id: bizcard.bizcard_id },
        data: {
          status: "cancelled",
          expires_at: now,
          auto_renew: false,
          cancel_reason: "immediate_cancellation_by_user",
        },
      });
      // Also update Bizcard table
      await tx.bizcard.update({
        where: { bizcard_id: bizcard.bizcard_id },
        data: {
          subscription_status: "expired",
          subscription_expires_at: now,
        },
      });
      await tx.subscriptionUpgradeLog.create({
        data: {
          bizcard_id: bizcard.bizcard_id,
          from_plan_id: existingSub.plan_id,
          to_plan_id: existingSub.plan_id,
          upgrade_type: "immediate_cancel",
          billing_cycle: existingSub.billing_cycle,
          amount_paid: 0,
          effective_date: now,
          expiry_date: now,
        },
      });
      return sub;
    });

    await logAuditEvent("SUBSCRIPTION_IMMEDIATE_CANCEL", session.userId, ip, request.headers.get("user-agent") ?? "", {
      planId: existingSub.plan_id.toString(),
      planName: existingSub.plan.name,
      bizcardSerialId,
    });

    return NextResponse.json(serialize({
      success: true,
      data: {
        subscription: {
          id: updated.id.toString(),
          status: updated.status,
          cancelledAt: now,
        },
      },
      message: "Your subscription has been cancelled immediately. All premium features are now disabled for this bizcard.",
    }));
  } catch (err) {
    console.error("[marketplace/subscription/cancel-immediate POST]", err);
    return NextResponse.json({ success: false, error: "An unexpected error occurred." }, { status: 500 });
  }
}