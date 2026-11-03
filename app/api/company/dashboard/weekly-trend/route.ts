import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@/lib/errors/types";
import { withCompanyAdmin } from "@/lib/auth/company-admin";
import {
  DashboardErrorCode,
  createDashboardError,
  extractDashboardErrorCode,
  toDashboardErrorResponse,
} from "@/lib/errors/dashboard-errors";
import { checkDashboardRateLimit } from "@/lib/rate-limit/dashboard-limits";
import { CompanyDashboardService } from "@/lib/services/company-dashboard.service";
import {
  assertValidTimezone,
  buildDailyBoundaries,
  getCurrentWeekDateRange,
} from "@/lib/utils/date-range";

export const GET = withCompanyAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { companyId, requestId } = context;

  try {
    const url = new URL(req.url);
    const timezone = url.searchParams.get("timezone") ?? "UTC";

    try {
      assertValidTimezone(timezone);
    } catch {
      throw createDashboardError(
        DashboardErrorCode.INVALID_TIMEZONE,
        "Invalid timezone",
        400,
        requestId,
        { timezone }
      );
    }

    const rateLimitResult = await checkDashboardRateLimit(req, "WEEKLY_TREND");
    if (!rateLimitResult.success) {
      return NextResponse.json(
        toDashboardErrorResponse(
          DashboardErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many requests. Please try again later.",
          requestId,
          { retryAfter: rateLimitResult.retryAfter },
          Date.now() - startedAt
        ),
        { status: 429 }
      );
    }

    const service = new CompanyDashboardService(companyId, requestId, timezone);
    const data = await service.getWeeklyTimeSeries();

    const weekStarts = getCurrentWeekDateRange(timezone);
    const weekBoundaries = buildDailyBoundaries(weekStarts[0], weekStarts[6], timezone, "EEE");

    return NextResponse.json({
      success: true,
      data,
      meta: {
        week_range: {
          start: weekBoundaries[0]?.dayStart.toISOString() ?? null,
          end:
            weekBoundaries[weekBoundaries.length - 1]
              ? new Date(weekBoundaries[weekBoundaries.length - 1].dayEndExclusive.getTime() - 1).toISOString()
              : null,
        },
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    const responseTime = Date.now() - startedAt;

    if (error instanceof AppError) {
      const code = extractDashboardErrorCode(error) ?? DashboardErrorCode.ANALYTICS_DATA_UNAVAILABLE;
      return NextResponse.json(
        toDashboardErrorResponse(
          code,
          error.message,
          error.requestId ?? requestId,
          error.details,
          responseTime
        ),
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      toDashboardErrorResponse(
        DashboardErrorCode.ANALYTICS_DATA_UNAVAILABLE,
        "Failed to fetch weekly trend data",
        requestId,
        undefined,
        responseTime
      ),
      { status: 500 }
    );
  }
});
