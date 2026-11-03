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
import { assertValidTimezone, formatDateForChart } from "@/lib/utils/date-range";
import { prisma } from "@/server/lib/prisma";

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

    const rateLimitResult = await checkDashboardRateLimit(req, "TOP_EMPLOYEE");
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
    const [topEmployee, totalEmployees] = await Promise.all([
      service.getTopEmployeeForToday(),
      prisma.companyEmployee.count({ where: { company_id: companyId, is_active: true } }),
    ]);

    if (!topEmployee) {
      return NextResponse.json({
        success: true,
        data: null,
        meta: {
          message: "No profile views recorded today",
          date: formatDateForChart(new Date(), "yyyy-MM-dd", timezone),
          total_employees: totalEmployees,
          requestId,
          responseTime: Date.now() - startedAt,
          timestamp: new Date().toISOString(),
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: topEmployee,
      meta: {
        date: formatDateForChart(new Date(), "yyyy-MM-dd", timezone),
        total_employees: totalEmployees,
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
        "Failed to fetch top employee",
        requestId,
        undefined,
        responseTime
      ),
      { status: 500 }
    );
  }
});
