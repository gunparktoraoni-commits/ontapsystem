import { NextRequest, NextResponse } from "next/server";
import { withSuperAdmin, type SuperAdminContext } from "@/lib/auth/superadmin-middleware";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp } from "@/server/lib/auth";
import { validateCsrfToken } from "@/lib/csrf";
import { isExperienceSurveyFeatureStatus } from "@/lib/portal/experience-survey";
import {
  getFeatureRequestById,
  updateFeatureRequestStatus,
} from "@/lib/services/superadmin-user-experience.service";

type RouteContext = SuperAdminContext & {
  params: Promise<{ surveyId: string }>;
};

export const GET = withSuperAdmin(async (_req: NextRequest, context: RouteContext) => {
  const { requestId } = context;
  const { surveyId } = await context.params;

  try {
    const row = await getFeatureRequestById(surveyId);
    if (!row) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "Feature request not found." },
        },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true, data: row, meta: { requestId } });
  } catch (error) {
    console.error("[SUPERADMIN_USER_EXPERIENCE_FEATURE_REQUEST_DETAIL]", error);
    return NextResponse.json(
      {
        success: false,
        error: { code: "FEATURE_REQUEST_FETCH_FAILED", message: "Failed to load feature request." },
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
  const body = (await req.json().catch(() => ({}))) as { feature_request_status?: string };
  const featureStatus = body.feature_request_status?.trim();

  if (!featureStatus || !isExperienceSurveyFeatureStatus(featureStatus)) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Invalid feature request status." },
      },
      { status: 400 },
    );
  }

  try {
    const data = await updateFeatureRequestStatus(surveyId, featureStatus);
    return NextResponse.json({ success: true, data, meta: { requestId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update feature request.";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json(
      {
        success: false,
        error: { code: "FEATURE_REQUEST_UPDATE_FAILED", message },
      },
      { status },
    );
  }
}, { errorMode: "superadmin" });
