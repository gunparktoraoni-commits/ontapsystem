import { NextRequest, NextResponse } from "next/server";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { generateRequestId } from "@/lib/utils/request-utils";
import {
  EXCLUSIVE_PREMIUM_DAYS,
  getExclusivePremiumOfferEligibility,
  markExclusiveOfferPresented,
  respondToExclusivePremiumOffer,
  ensurePremiumBoostFreshness,
} from "@/lib/services/premium-experience.service";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

/**
 * GET /api/user/premium-experience-offer
 * Exclusive 3-day premium offer status for the authenticated free-trial user.
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId();
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("user-premium-experience", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests.",
          tag: "[PREMIUM_EXPERIENCE_API]",
        },
        meta: { requestId },
      },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } },
    );
  }

  const auth = await resolveRequestSession(request, { tryRefresh: true });
  if (!auth.session) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required",
          tag: "[PREMIUM_EXPERIENCE_API]",
          requestId,
        },
      },
      { status: 401 },
    );
  }

  try {
    const userId = BigInt(auth.session.userId);
    await ensurePremiumBoostFreshness(userId);
    const eligibility = await getExclusivePremiumOfferEligibility(userId);

    if (eligibility.eligible) {
      await markExclusiveOfferPresented(userId).catch(() => undefined);
    }

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          eligible: eligibility.eligible,
          reason: eligibility.reason,
          offer_status: eligibility.offerStatus,
          free_trial_active: eligibility.freeTrialActive,
          free_trial_ends_at: eligibility.freeTrialEndsAt,
          exclusive_days: EXCLUSIVE_PREMIUM_DAYS,
          boost: {
            active: eligibility.boost.active,
            until: eligibility.boost.until,
            source: eligibility.boost.source,
            days_remaining: eligibility.boost.daysRemaining,
          },
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      }),
    );
  } catch (error) {
    console.error("[PREMIUM_EXPERIENCE_API] OFFER_STATUS_FAILED", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "PREMIUM_OFFER_STATUS_FAILED",
          message: "Failed to load exclusive premium offer status.",
          tag: "[PREMIUM_EXPERIENCE_API]",
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/user/premium-experience-offer
 * Body: { decision: "accept" | "decline" }
 */
export async function POST(request: NextRequest) {
  const requestId = generateRequestId();
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("user-premium-experience-mutate", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests.",
          tag: "[PREMIUM_EXPERIENCE_API]",
        },
        meta: { requestId },
      },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } },
    );
  }

  const auth = await resolveRequestSession(request, { tryRefresh: true });
  if (!auth.session) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required",
          tag: "[PREMIUM_EXPERIENCE_API]",
          requestId,
        },
      },
      { status: 401 },
    );
  }

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const decisionRaw = String(body?.decision ?? "").trim().toLowerCase();
    if (decisionRaw !== "accept" && decisionRaw !== "decline") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_DECISION",
            message: 'decision must be "accept" or "decline".',
            tag: "[PREMIUM_EXPERIENCE_API]",
          },
          meta: { requestId },
        },
        { status: 400 },
      );
    }

    const userId = BigInt(auth.session.userId);
    await ensurePremiumBoostFreshness(userId);
    const result = await respondToExclusivePremiumOffer(userId, decisionRaw);

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "PREMIUM_OFFER_INELIGIBLE",
            message: result.message,
            tag: "[PREMIUM_EXPERIENCE_API]",
            status: result.status,
          },
          meta: { requestId },
        },
        { status: 403 },
      );
    }

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          status: result.status,
          boost_until: result.boostUntil ?? null,
          exclusive_days: EXCLUSIVE_PREMIUM_DAYS,
          message: result.message,
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      }),
    );
  } catch (error) {
    console.error("[PREMIUM_EXPERIENCE_API] OFFER_RESPOND_FAILED", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "PREMIUM_OFFER_RESPOND_FAILED",
          message: "Failed to record exclusive premium offer response.",
          tag: "[PREMIUM_EXPERIENCE_API]",
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status: 500 },
    );
  }
}
