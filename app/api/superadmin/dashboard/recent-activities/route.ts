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
import {
  parsePagination,
  parseSuperAdminDateRangeFromSearchParams,
} from "@/lib/utils/superadmin-query";

export const GET = withDashboardSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkSuperAdminDashboardRateLimit(req, "RECENT_ACTIVITIES", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many recent activity requests. Please try again later.",
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

    const pagination = parsePagination(req.nextUrl.searchParams, 20, 100);
    const dateRange = parseSuperAdminDateRangeFromSearchParams(req.nextUrl.searchParams, requestId, {
      defaultFilter: "this_week",
      maxDays: 90,
    });

    const service = new SuperAdminDashboardService(requestId);
    const result = await service.getRecentActivities({
      page: pagination.page,
      limit: pagination.limit,
      dateRange,
      activityType: req.nextUrl.searchParams.get("activity_type")?.trim() || undefined,
    });

    const total = result.summary.total_activities;
    const totalPages = Math.max(1, Math.ceil(total / pagination.limit));

    return NextResponse.json({
      success: true,
      data: result,
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total,
          totalPages,
          hasNextPage: pagination.page < totalPages,
          hasPreviousPage: pagination.page > 1,
        },
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
      "Failed to fetch recent activities"
    );
  }
});
