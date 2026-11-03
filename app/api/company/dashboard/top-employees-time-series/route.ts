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
  getDateRange,
  validateDateRange,
} from "@/lib/utils/date-range";

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const GET = withCompanyAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { companyId, requestId } = context;

  try {
    const url = new URL(req.url);
    const startDate = url.searchParams.get("start_date") ?? "";
    const endDate = url.searchParams.get("end_date") ?? "";
    const timezone = url.searchParams.get("timezone") ?? "UTC";
    const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "5", 10);
    const limit = Number.isInteger(limitRaw) ? Math.min(10, Math.max(1, limitRaw)) : 5;

    if (!ISO_DATE_REGEX.test(startDate) || !ISO_DATE_REGEX.test(endDate)) {
      throw createDashboardError(
        DashboardErrorCode.INVALID_DATE_RANGE,
        "start_date and end_date are required in YYYY-MM-DD format",
        400,
        requestId,
        { start_date: startDate || null, end_date: endDate || null },
      );
    }

    try {
      assertValidTimezone(timezone);
    } catch {
      throw createDashboardError(
        DashboardErrorCode.INVALID_TIMEZONE,
        "Invalid timezone",
        400,
        requestId,
        { timezone },
      );
    }

    const dateRange = getDateRange("custom", startDate, endDate, timezone);
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
        },
      );
    }

    const rateLimitResult = await checkDashboardRateLimit(req, "TIME_SERIES");
    if (!rateLimitResult.success) {
      return NextResponse.json(
        toDashboardErrorResponse(
          DashboardErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many requests. Please try again later.",
          requestId,
          { retryAfter: rateLimitResult.retryAfter },
          Date.now() - startedAt,
        ),
        { status: 429 },
      );
    }

    const service = new CompanyDashboardService(companyId, requestId, timezone);
    const data = await service.getTopEmployeesTimeSeries(dateRange.start, dateRange.end, limit);
    const boundaries = buildDailyBoundaries(dateRange.start, dateRange.end, timezone, "MMM dd");

    return NextResponse.json({
      success: true,
      data,
      meta: {
        date_range: {
          start: startDate,
          end: endDate,
          days: boundaries.length,
        },
        limit,
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
          responseTime,
        ),
        { status: error.statusCode },
      );
    }

    return NextResponse.json(
      toDashboardErrorResponse(
        DashboardErrorCode.ANALYTICS_DATA_UNAVAILABLE,
        "Failed to fetch top employee time series data",
        requestId,
        undefined,
        responseTime,
      ),
      { status: 500 },
    );
  }
});
