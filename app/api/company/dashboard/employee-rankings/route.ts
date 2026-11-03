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
import {
  CompanyDashboardService,
  type RankingMetric,
} from "@/lib/services/company-dashboard.service";
import {
  type FilterType,
  assertValidTimezone,
  getDateRange,
  validateDateRange,
} from "@/lib/utils/date-range";

const ALLOWED_FILTERS: FilterType[] = ["today", "last_7_days", "last_30_days", "this_week", "this_month", "last_month", "custom"];
const ALLOWED_METRICS: RankingMetric[] = ["profile_views", "leads", "inquiries"];

function parseFilter(raw: string | null, requestId: string): FilterType {
  const normalized = (raw ?? "today").toLowerCase();
  if (ALLOWED_FILTERS.includes(normalized as FilterType)) {
    return normalized as FilterType;
  }

  throw createDashboardError(
    DashboardErrorCode.INVALID_FILTER_TYPE,
    "Invalid filter type. Allowed: today, last_7_days, last_30_days, this_week, this_month, last_month, custom",
    400,
    requestId,
    { filter: raw }
  );
}

function parseMetric(raw: string | null, requestId: string): RankingMetric {
  const normalized = (raw ?? "profile_views").toLowerCase();
  if (ALLOWED_METRICS.includes(normalized as RankingMetric)) {
    return normalized as RankingMetric;
  }

  throw createDashboardError(
    DashboardErrorCode.INVALID_FILTER_TYPE,
    "Invalid metric. Allowed: profile_views, leads, inquiries",
    400,
    requestId,
    { metric: raw }
  );
}

function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isInteger(parsed)) return 5;
  return Math.min(20, Math.max(1, parsed));
}

export const GET = withCompanyAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { companyId, requestId } = context;

  try {
    const url = new URL(req.url);
    const filter = parseFilter(url.searchParams.get("filter"), requestId);
    const metric = parseMetric(url.searchParams.get("metric"), requestId);
    const limit = parseLimit(url.searchParams.get("limit"));
    const startDate = url.searchParams.get("start_date") ?? undefined;
    const endDate = url.searchParams.get("end_date") ?? undefined;
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

    if (filter === "custom" && (!startDate || !endDate)) {
      throw createDashboardError(
        DashboardErrorCode.INVALID_DATE_RANGE,
        "Custom date range requires start_date and end_date",
        400,
        requestId,
        { filter }
      );
    }

    const dateRange = getDateRange(filter, startDate, endDate, timezone);
    if (!validateDateRange(dateRange.start, dateRange.end, 90)) {
      throw createDashboardError(
        DashboardErrorCode.DATE_RANGE_TOO_LARGE,
        "Date range exceeds maximum of 90 days",
        400,
        requestId,
        {
          start: dateRange.start.toISOString(),
          end: dateRange.end.toISOString(),
          maxDays: 90,
        }
      );
    }

    const rateLimitResult = await checkDashboardRateLimit(req, "EMPLOYEE_RANKINGS");
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
    const data = await service.getEmployeeRankings(filter, metric, limit, startDate, endDate);

    return NextResponse.json({
      success: true,
      data,
      meta: {
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
        "Failed to fetch employee rankings",
        requestId,
        undefined,
        responseTime
      ),
      { status: 500 }
    );
  }
});
