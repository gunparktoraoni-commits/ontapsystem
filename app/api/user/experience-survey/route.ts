import { NextRequest, NextResponse } from "next/server";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { generateRequestId } from "@/lib/utils/request-utils";
import {
  dismissExperienceSurvey,
  getExperienceSurveyEligibility,
  submitExperienceSurvey,
} from "@/lib/services/user-experience-survey.service";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

/**
 * GET /api/user/experience-survey
 * Returns whether the authenticated user should see the experience survey modal.
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId();
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("user-experience-survey", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests.",
          tag: "[EXPERIENCE_SURVEY_API]",
        },
        meta: { requestId },
      },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
      },
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
          tag: "[EXPERIENCE_SURVEY_API]",
          requestId,
        },
      },
      { status: 401 },
    );
  }

  try {
    const eligibility = await getExperienceSurveyEligibility(auth.session.userId);
    return NextResponse.json(
      serialize({
        success: true,
        data: {
          eligible: eligibility.eligible,
          reason: eligibility.reason,
          status: eligibility.status,
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      }),
    );
  } catch (error) {
    console.error("[EXPERIENCE_SURVEY_API] STATUS_FAILED", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "EXPERIENCE_SURVEY_STATUS_FAILED",
          message: "Failed to load experience survey status.",
          tag: "[EXPERIENCE_SURVEY_API]",
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/user/experience-survey
 * Body:
 * - submit: { action: "submit", rating: 1-5, feedback?: string, feature_suggestion?: string }
 * - dismiss: { action: "dismiss" }
 */
export async function POST(request: NextRequest) {
  const requestId = generateRequestId();
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("user-experience-survey-mutate", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests.",
          tag: "[EXPERIENCE_SURVEY_API]",
        },
        meta: { requestId },
      },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
      },
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
          tag: "[EXPERIENCE_SURVEY_API]",
          requestId,
        },
      },
      { status: 401 },
    );
  }

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const action = String(body?.action ?? "").trim().toLowerCase();

    if (action === "dismiss") {
      const result = await dismissExperienceSurvey(auth.session.userId);
      return NextResponse.json(
        serialize({
          success: true,
          data: { status: result.status },
          meta: { requestId, timestamp: new Date().toISOString() },
        }),
      );
    }

    if (action !== "submit") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_ACTION",
            message: 'action must be "submit" or "dismiss".',
            tag: "[EXPERIENCE_SURVEY_API]",
          },
          meta: { requestId },
        },
        { status: 400 },
      );
    }

    const result = await submitExperienceSurvey(auth.session.userId, {
      rating: Number(body?.rating),
      feedback:
        typeof body?.feedback === "string" || body?.feedback == null
          ? (body?.feedback as string | null | undefined)
          : String(body?.feedback),
      featureSuggestion:
        typeof body?.feature_suggestion === "string" || body?.feature_suggestion == null
          ? (body?.feature_suggestion as string | null | undefined)
          : String(body?.feature_suggestion),
    });

    return NextResponse.json(
      serialize({
        success: true,
        data: { status: result.status },
        meta: { requestId, timestamp: new Date().toISOString() },
      }),
      { status: 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save experience survey response.";
    const status = /already submitted/i.test(message)
      ? 409
      : /rating must be|between 1 and 5/i.test(message)
        ? 422
        : 400;

    console.error("[EXPERIENCE_SURVEY_API] MUTATE_FAILED", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code:
            status === 409
              ? "EXPERIENCE_SURVEY_ALREADY_SUBMITTED"
              : status === 422
                ? "VALIDATION_ERROR"
                : "EXPERIENCE_SURVEY_SAVE_FAILED",
          message,
          tag: "[EXPERIENCE_SURVEY_API]",
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status },
    );
  }
}
