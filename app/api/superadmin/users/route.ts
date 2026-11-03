import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  SuperAdminErrorCode,
  createSuperAdminError,
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

const STATUS_FILTERS = new Set(["all", "active", "restricted"]);
const ROLE_FILTERS = new Set(["all", "user", "staff", "admin", "super_admin", "company_admin", "dev"]);
const SORT_FIELDS = new Set(["created_at", "last_active", "name", "email"]);
const SORT_DIRECTIONS = new Set(["asc", "desc"]);

export const GET = withDashboardSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkSuperAdminDashboardRateLimit(req, "USERS", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many users requests. Please try again later.",
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

    const params = req.nextUrl.searchParams;
    // maxLimit raised from 100 → 10000 to allow full-dataset retrieval for
    // the Super Admin Users feature.
    const pagination = parsePagination(params, 20, 10000);
    const rawStatus = (params.get("status") ?? "all").trim().toLowerCase();
    const rawRole = (params.get("role") ?? "user").trim().toLowerCase();
    const rawSortBy = (params.get("sort_by") ?? "created_at").trim().toLowerCase();
    const rawSortDir = (params.get("sort_dir") ?? "desc").trim().toLowerCase();

    if (!STATUS_FILTERS.has(rawStatus)) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_STATUS_FILTER,
        "Invalid status filter",
        400,
        requestId,
        { status: rawStatus, allowed: [...STATUS_FILTERS] }
      );
    }

    if (!ROLE_FILTERS.has(rawRole)) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        "Invalid role filter",
        400,
        requestId,
        { role: rawRole, allowed: [...ROLE_FILTERS] }
      );
    }

    if (!SORT_FIELDS.has(rawSortBy)) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_SORT_FIELD,
        "Invalid sort_by value",
        400,
        requestId,
        { sort_by: rawSortBy, allowed: [...SORT_FIELDS] }
      );
    }

    if (!SORT_DIRECTIONS.has(rawSortDir)) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_SORT_FIELD,
        "Invalid sort_dir value",
        400,
        requestId,
        { sort_dir: rawSortDir, allowed: [...SORT_DIRECTIONS] }
      );
    }

    const shouldApplyDateRange =
      params.has("date_filter") || params.has("custom_start_date") || params.has("custom_end_date");

    const dateRange = shouldApplyDateRange
      ? parseSuperAdminDateRangeFromSearchParams(params, requestId, {
          defaultFilter: "this_month",
          maxDays: 90,
        })
      : undefined;

    const service = new SuperAdminDashboardService(requestId);
    const result = await service.getUsers({
      page: pagination.page,
      limit: pagination.limit,
      search: params.get("search")?.trim() || undefined,
      status: rawStatus as "all" | "active" | "restricted",
      role: rawRole as "all" | "user" | "staff" | "admin" | "super_admin" | "company_admin" | "dev",
      subscriptionType: (params.get("subscription_type") ?? "all").trim().toLowerCase(),
      sortBy: rawSortBy as "created_at" | "last_active" | "name" | "email",
      sortDir: rawSortDir as "asc" | "desc",
      dateRange,
    });

    const total = result.summary.total_users;
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
        ...(dateRange
          ? {
              date_range: formatDateRangeMeta(dateRange),
              comparison: {
                period: "vs previous period",
                calculation_method: "percentage_change",
              },
            }
          : {}),
      },
    });
  } catch (error) {
    return toSuperAdminErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to fetch users"
    );
  }
});
