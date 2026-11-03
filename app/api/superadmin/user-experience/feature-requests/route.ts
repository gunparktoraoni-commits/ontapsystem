import { NextRequest, NextResponse } from "next/server";
import { withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp } from "@/server/lib/auth";
import { isExperienceSurveyFeatureStatus } from "@/lib/portal/experience-survey";
import { listFeatureRequests } from "@/lib/services/superadmin-user-experience.service";

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export const GET = withSuperAdmin(async (req: NextRequest, context) => {
  const { requestId } = context;
  const ip = getClientIp(req);
  const rateCheck = checkRateLimit("superadmin-user-experience", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests.",
        },
      },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
      },
    );
  }

  try {
    const searchParams = req.nextUrl.searchParams;
    const featureStatusRaw = searchParams.get("feature_request_status")?.trim() || undefined;
    const featureStatus =
      featureStatusRaw && isExperienceSurveyFeatureStatus(featureStatusRaw)
        ? featureStatusRaw
        : undefined;

    const data = await listFeatureRequests({
      page: parsePositiveInt(searchParams.get("page"), 1, 1, 100000),
      limit: parsePositiveInt(searchParams.get("limit"), 20, 1, 100),
      search: searchParams.get("search")?.trim() || undefined,
      feature_request_status: featureStatus,
      dateFrom: searchParams.get("dateFrom")?.trim() || undefined,
      dateTo: searchParams.get("dateTo")?.trim() || undefined,
    });

    return NextResponse.json({ success: true, data, meta: { requestId } });
  } catch (error) {
    console.error("[SUPERADMIN_USER_EXPERIENCE_FEATURE_REQUESTS]", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "FEATURE_REQUESTS_FETCH_FAILED",
          message: "Failed to load feature requests.",
        },
      },
      { status: 500 },
    );
  }
}, { errorMode: "superadmin" });
