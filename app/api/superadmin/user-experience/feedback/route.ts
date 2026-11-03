import { NextRequest, NextResponse } from "next/server";
import { withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp } from "@/server/lib/auth";
import { isExperienceSurveyReviewStatus } from "@/lib/portal/experience-survey";
import { listFeedback } from "@/lib/services/superadmin-user-experience.service";

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
    const ratingRaw = searchParams.get("rating");
    const ratingParsed = ratingRaw ? Number.parseInt(ratingRaw, 10) : undefined;
    const rating =
      ratingParsed != null &&
      Number.isInteger(ratingParsed) &&
      ratingParsed >= 1 &&
      ratingParsed <= 5
        ? ratingParsed
        : undefined;

    const reviewStatusRaw = searchParams.get("review_status")?.trim() || undefined;
    const reviewStatus =
      reviewStatusRaw && isExperienceSurveyReviewStatus(reviewStatusRaw)
        ? reviewStatusRaw
        : undefined;

    const data = await listFeedback({
      page: parsePositiveInt(searchParams.get("page"), 1, 1, 100000),
      limit: parsePositiveInt(searchParams.get("limit"), 20, 1, 100),
      search: searchParams.get("search")?.trim() || undefined,
      rating,
      review_status: reviewStatus,
      dateFrom: searchParams.get("dateFrom")?.trim() || undefined,
      dateTo: searchParams.get("dateTo")?.trim() || undefined,
    });

    return NextResponse.json({ success: true, data, meta: { requestId } });
  } catch (error) {
    console.error("[SUPERADMIN_USER_EXPERIENCE_FEEDBACK]", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "FEEDBACK_FETCH_FAILED",
          message: "Failed to load feedback.",
        },
      },
      { status: 500 },
    );
  }
}, { errorMode: "superadmin" });
