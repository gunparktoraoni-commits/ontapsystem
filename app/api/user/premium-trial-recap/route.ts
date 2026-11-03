import { NextRequest, NextResponse } from "next/server";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { generateRequestId } from "@/lib/utils/request-utils";
import {
  buildPremiumTrialRecapSummary,
  dismissPremiumTrialRecap,
  getPremiumTrialRecapEligibility,
} from "@/lib/services/premium-experience.service";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

/**
 * GET /api/user/premium-trial-recap
 * Summary shown after the exclusive 3-day Premium trial ends.
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId();
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("user-premium-trial-recap", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "RATE_LIMITED", message: "Too many requests.", tag: "[PREMIUM_TRIAL_RECAP_API]" },
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
          tag: "[PREMIUM_TRIAL_RECAP_API]",
        },
        meta: { requestId },
      },
      { status: 401 },
    );
  }

  try {
    const userId = BigInt(auth.session.userId);
    const eligibility = await getPremiumTrialRecapEligibility(userId);

    if (!eligibility.eligible) {
      return NextResponse.json(
        serialize({
          success: true,
          data: {
            eligible: false,
            reason: eligibility.reason,
            summary: null,
          },
          meta: { requestId, timestamp: new Date().toISOString() },
        }),
      );
    }

    const summary = await buildPremiumTrialRecapSummary(userId);

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          eligible: true,
          reason: eligibility.reason,
          summary,
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      }),
    );
  } catch (error) {
    console.error("[PREMIUM_TRIAL_RECAP_API] FETCH_FAILED", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "PREMIUM_TRIAL_RECAP_FETCH_FAILED",
          message: "Failed to load premium trial recap.",
          tag: "[PREMIUM_TRIAL_RECAP_API]",
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/user/premium-trial-recap
 * Body: { action: "dismiss" }
 */
export async function POST(request: NextRequest) {
  const requestId = generateRequestId();
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("user-premium-trial-recap-mutate", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "RATE_LIMITED", message: "Too many requests.", tag: "[PREMIUM_TRIAL_RECAP_API]" },
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
          tag: "[PREMIUM_TRIAL_RECAP_API]",
        },
        meta: { requestId },
      },
      { status: 401 },
    );
  }

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const action = String(body?.action ?? "").trim().toLowerCase();
    if (action !== "dismiss") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_ACTION",
            message: 'action must be "dismiss".',
            tag: "[PREMIUM_TRIAL_RECAP_API]",
          },
          meta: { requestId },
        },
        { status: 400 },
      );
    }

    const userId = BigInt(auth.session.userId);
    await dismissPremiumTrialRecap(userId);

    return NextResponse.json(
      serialize({
        success: true,
        data: { dismissed: true },
        meta: { requestId, timestamp: new Date().toISOString() },
      }),
    );
  } catch (error) {
    console.error("[PREMIUM_TRIAL_RECAP_API] DISMISS_FAILED", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "PREMIUM_TRIAL_RECAP_DISMISS_FAILED",
          message: "Failed to dismiss premium trial recap.",
          tag: "[PREMIUM_TRIAL_RECAP_API]",
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status: 500 },
    );
  }
}
