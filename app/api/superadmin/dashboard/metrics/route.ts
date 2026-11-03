import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  SuperAdminErrorCode,
  toSuperAdminErrorResponse,
} from "@/lib/errors/superadmin-errors";
import { toSuperAdminErrorNextResponse } from "@/lib/errors/superadmin-http";
import { checkSuperAdminDashboardRateLimit } from "@/lib/rate-limit/superadmin-dashboard-limits";
import { SuperAdminDashboardService } from "@/lib/services/superadmin-dashboard.service";
import { formatDateRangeMeta } from "@/lib/utils/superadmin-date-range";
import { parseSuperAdminDateRangeFromSearchParams } from "@/lib/utils/superadmin-query";

export const GET = withDashboardSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkSuperAdminDashboardRateLimit(req, "METRICS", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many dashboard metrics requests. Please try again later.",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfter ?? 1),
          },
        }
      );
    }

    const dateRange = parseSuperAdminDateRangeFromSearchParams(req.nextUrl.searchParams, requestId, {
      defaultFilter: "this_month",
      maxDays: 90,
    });

    const service = new SuperAdminDashboardService(requestId);
    const metrics = await service.getDashboardMetrics(dateRange);

    return NextResponse.json({
      success: true,
      data: metrics,
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
        date_range: formatDateRangeMeta(dateRange),
        comparison: {
          period: "vs previous period",
          calculation_method: "percentage_change",
        },
      },
    });
  } catch (error) {
    return toSuperAdminErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to fetch superadmin dashboard metrics"
    );
  }
});
