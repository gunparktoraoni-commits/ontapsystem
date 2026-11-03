// POST /api/marketplace/subscription/cancel
// Auth required — cancels subscription at end of current billing period.
// Returns a retention offer on cancellation.
// Rate limit: 5/hr per IP.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { validateSubscriptionCancelInput } from "@/server/lib/validators";

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

  const rateCheck = checkRateLimit("marketplace-sub-cancel", ip);
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
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ success: false, error: "Invalid request payload." }, { status: 400 });
    }

    const validation = validateSubscriptionCancelInput(body as Record<string, unknown>);
    if (!validation.valid) {
      return NextResponse.json({ success: false, error: validation.errors[0] ?? "Validation failed." }, { status: 400 });
    }

    // Use type assertion until validator is updated to include bizcardSerialId
    const { reason, feedback, bizcardSerialId } = validation.data as any;
    const userId = BigInt(session.userId);

    // Verify bizcard belongs to user
    const bizcard = await prisma.bizcard.findFirst({
      where: { serial_id: bizcardSerialId, user_id: userId, deactivated_flag: false },
    });
    if (!bizcard) {
      return NextResponse.json(
        { success: false, error: "Bizcard not found or access denied." },
        { status: 404 }
      );
    }

    const existingSub = await prisma.bizcardSubscription.findUnique({
      where: { bizcard_id: bizcard.bizcard_id },
      include: { plan: true },
    });

    if (!existingSub || existingSub.status === "cancelled") {
      return NextResponse.json(
        { success: false, error: "No active subscription found for this bizcard." },
        { status: 404 }
      );
    }

    if (!existingSub.auto_renew) {
      return NextResponse.json(
        {
          success: false,
          error: "Subscription is already set to cancel at period end.",
          data: { effectiveDate: existingSub.expires_at },
        },
        { status: 409 }
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const sub = await tx.bizcardSubscription.update({
        where: { bizcard_id: bizcard.bizcard_id },
        data: {
          auto_renew: false,
          cancel_reason: reason ?? null,
          cancel_feedback: feedback ?? null,
        },
      });

      await tx.subscriptionUpgradeLog.create({
        data: {
          bizcard_id: bizcard.bizcard_id,
          from_plan_id: existingSub.plan_id,
          to_plan_id: existingSub.plan_id,
          upgrade_type: "cancel_scheduled",
          billing_cycle: existingSub.billing_cycle,
          amount_paid: 0,
          effective_date: existingSub.expires_at,
        },
      });

      return sub;
    });

    // Retention offer
    const retentionOffer = {
      message: "We hate to see you go! As a valued customer, we can offer you 30% off your next 3 months.",
      promoCode: "STAYWITHUSNOW30",
      discountPercent: 30,
      validForMonths: 3,
    };

    return NextResponse.json(serialize({
      success: true,
      data: {
        subscription: {
          id: updated.id.toString(),
          autoRenew: false,
          effectiveDate: existingSub.expires_at,
          planName: existingSub.plan.name,
        },
        retentionOffer,
      },
      message: `Your subscription for bizcard #${bizcardSerialId} will remain active until ${existingSub.expires_at.toISOString()}. You can reactivate at any time.`,
    }));
  } catch (err) {
    console.error("[marketplace/subscription/cancel POST]", err);
    return NextResponse.json({ success: false, error: "An unexpected error occurred." }, { status: 500 });
  }
}