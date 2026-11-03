import { NextRequest, NextResponse } from "next/server";
import { withSuperAdmin, type SuperAdminContext } from "@/lib/auth/superadmin-middleware";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp } from "@/server/lib/auth";
import { validateCsrfToken } from "@/lib/csrf";
import { isExperienceSurveyReviewStatus } from "@/lib/portal/experience-survey";
import {
  getFeedbackById,
  updateFeedbackReviewStatus,
} from "@/lib/services/superadmin-user-experience.service";

type RouteContext = SuperAdminContext & {
  params: Promise<{ surveyId: string }>;
};

export const GET = withSuperAdmin(async (_req: NextRequest, context: RouteContext) => {
  const { requestId } = context;
  const { surveyId } = await context.params;

  try {
    const row = await getFeedbackById(surveyId);
    if (!row) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "Feedback not found." },
        },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true, data: row, meta: { requestId } });
  } catch (error) {
    console.error("[SUPERADMIN_USER_EXPERIENCE_FEEDBACK_DETAIL]", error);
    return NextResponse.json(
      {
        success: false,
        error: { code: "FEEDBACK_FETCH_FAILED", message: "Failed to load feedback." },
      },
      { status: 500 },
    );
  }
}, { errorMode: "superadmin" });

export const PATCH = withSuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const { requestId } = context;
  const ip = getClientIp(req);
  const rateCheck = checkRateLimit("superadmin-user-experience-mutate", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "RATE_LIMITED", message: "Too many requests." },
      },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
      },
    );
  }

  const csrfValid = await validateCsrfToken(req);
  if (!csrfValid) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "CSRF_INVALID", message: "CSRF validation failed." },
      },
      { status: 403 },
    );
  }

  const { surveyId } = await context.params;
  const body = (await req.json().catch(() => ({}))) as { review_status?: string };
  const reviewStatus = body.review_status?.trim();

  if (!reviewStatus || !isExperienceSurveyReviewStatus(reviewStatus)) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Invalid review status." },
      },
      { status: 400 },
    );
  }

  try {
    const data = await updateFeedbackReviewStatus(surveyId, reviewStatus);
    return NextResponse.json({ success: true, data, meta: { requestId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update feedback.";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json(
      {
        success: false,
        error: { code: "FEEDBACK_UPDATE_FAILED", message },
      },
      { status },
    );
  }
}, { errorMode: "superadmin" });
