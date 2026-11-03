// app/api/user/subscription/upgrade/route.ts
import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { subscriptionService } from "@/lib/services/subscription.service";
import { prisma } from "@/server/lib/prisma";
import {
  SubscriptionErrorCode,
} from "@/lib/errors/subscription-errors";
import { generateRequestId } from "@/lib/utils/request-utils";
import { z } from "zod";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

// Validation schema — now requires bizcardSerialId
const upgradeSchema = z.object({
  tier: z.enum(["basic", "standard", "premium"]),
  billing_cycle: z.enum(["monthly", "yearly"]),
  bizcard_serial_id: z.string().min(1, "bizcard_serial_id is required"),
  payment_method_id: z.string().optional(),
});

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
  const requestId = generateRequestId();
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("user-subscription-upgrade", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RATE_LIMIT",
          message: "Too many upgrade attempts. Please try again later.",
          retry_after: Math.ceil(rateCheck.retryAfterMs / 1000),
        },
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
        },
      },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const { session } = auth;

  try {
    const body = await request.json();

    const validation = upgradeSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid upgrade request",
            details: validation.error.issues,
          },
          meta: {
            requestId,
            timestamp: new Date().toISOString(),
          },
        },
        { status: 400 }
      );
    }

    const { tier, billing_cycle, bizcard_serial_id, payment_method_id } = validation.data;
    const userId = BigInt(session.userId);

    // Verify the bizcard belongs to the user
    const bizcard = await prisma.bizcard.findFirst({
      where: { serial_id: bizcard_serial_id, user_id: userId, deactivated_flag: false },
      select: { bizcard_id: true },
    });
    if (!bizcard) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "BIZCARD_NOT_FOUND",
            message: "Bizcard not found or does not belong to you.",
          },
          meta: { requestId, timestamp: new Date().toISOString() },
        },
        { status: 404 }
      );
    }

    // Get current subscription status (for this user, we'll get the highest tier)
    const currentStatus = await subscriptionService.getSubscriptionStatus(userId);

    // Prevent downgrade from higher tier
    const tierHierarchy = ["free_trial", "basic", "standard", "premium"];
    const currentTierIndex = tierHierarchy.indexOf(currentStatus.tier);
    const newTierIndex = tierHierarchy.indexOf(tier);

    if (currentTierIndex > newTierIndex) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: SubscriptionErrorCode.INVALID_TIER,
            message: "Cannot downgrade subscription. Please contact support.",
          },
          meta: {
            requestId,
            timestamp: new Date().toISOString(),
          },
        },
        { status: 400 }
      );
    }

    // TODO: Process payment if payment_method_id provided

    // Perform upgrade — passing the bizcardSerialId
    await subscriptionService.upgradeSubscription(
      userId,
      tier,
      billing_cycle,
      bizcard_serial_id
    );

    const newStatus = await subscriptionService.getSubscriptionStatus(userId);

    const response = {
      success: true,
      message: "Subscription upgraded successfully",
      data: {
        previous_tier: currentStatus.tier,
        new_tier: tier,
        billing_cycle,
        expires_at: newStatus.expiresAt?.toISOString(),
        status: newStatus.status,
        bizcard_serial_id,
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
      },
    };

    return NextResponse.json(serialize(response));
  } catch (error) {
    console.error("[Subscription Upgrade] Error:", error);

    if (error instanceof Error && error.message.includes("Invalid tier")) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: SubscriptionErrorCode.INVALID_TIER,
            message: "Invalid subscription tier selected",
          },
          meta: {
            requestId,
            timestamp: new Date().toISOString(),
          },
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to upgrade subscription",
        },
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}