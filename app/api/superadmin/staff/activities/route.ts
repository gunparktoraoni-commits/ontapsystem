// ──────────────────────────────────────────────────────────────
// GET /api/superadmin/staff/activities
// ──────────────────────────────────────────────────────────────
// Superadmin staff activities endpoint
// Provides paginated staff activity logs with search and date filtering
// Requires superadmin authentication
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { 
  SuperAdminDashboardErrorCode,
  createSuperAdminError
} from "@/lib/errors/superadmin-dashboard-errors";
import { 
  resolveSuperAdminDateRange,
  formatDateRangeMeta
} from "@/lib/utils/superadmin-date-range";
import { 
  withDashboardSuperAdmin,
  checkSuperadminDashboardRateLimit
} from "@/middleware/superadmin-auth";
import { 
  parsePaginationParams,
  createPaginationMeta,
  extractSearchQuery,
  validateSortParams,
  generateRequestId
} from "@/lib/utils/request-utils";

export const GET = withDashboardSuperAdmin(async (req: NextRequest) => {
  const requestId = generateRequestId();
  const startTime = Date.now();

  try {
    // Rate limiting check
    const rateLimitResult = await checkSuperadminDashboardRateLimit(req, "STAFF_ACTIVITIES");
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: createSuperAdminError(
            SuperAdminDashboardErrorCode.RATE_LIMIT_EXCEEDED,
            "Rate limit exceeded for staff activities"
          ),
          meta: { requestId, responseTime: Date.now() - startTime }
        },
        { status: 429 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(req.url);
    const { page, limit, offset } = parsePaginationParams(searchParams);
    const search = extractSearchQuery(searchParams);
    const filter = searchParams.get('filter') as any || 'this_month';
    const customStartDate = searchParams.get('start_date') || undefined;
    const customEndDate = searchParams.get('end_date') || undefined;
    const timezone = searchParams.get('timezone') || 'UTC';

    // Validate sort parameters
    const sortOptions = validateSortParams(searchParams, [
      'created_at', 'action', 'staff_name', 'staff_email'
    ]);

    // Validate date range
    try {
      const dateRange = resolveSuperAdminDateRange(filter, customStartDate, customEndDate, timezone);
      
      // Get staff activities
      const activities = await getStaffActivities(dateRange, search, sortOptions, offset, limit);
      
      // Get total count for pagination
      const totalCount = await getStaffActivitiesCount(dateRange, search);
      
      // Create pagination metadata
      const pagination = createPaginationMeta(page, limit, totalCount);

      return NextResponse.json({
        success: true,
        data: {
          logs: activities,
          pagination
        },
        meta: {
          requestId,
          responseTime: Date.now() - startTime,
          timestamp: new Date().toISOString(),
          dateRange: formatDateRangeMeta(dateRange),
          filters: {
            search,
            sort: sortOptions
          }
        }
      });

    } catch (dateError) {
      return NextResponse.json(
        {
          success: false,
          error: createSuperAdminError(
            SuperAdminDashboardErrorCode.INVALID_DATE_RANGE,
            dateError instanceof Error ? dateError.message : "Invalid date range"
          ),
          meta: { requestId, responseTime: Date.now() - startTime }
        },
        { status: 400 }
      );
    }

  } catch (error) {
    console.error('Staff activities error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: createSuperAdminError(
          SuperAdminDashboardErrorCode.DATABASE_ERROR,
          "Failed to fetch staff activities"
        ),
        meta: { requestId, responseTime: Date.now() - startTime }
      },
      { status: 500 }
    );
  }
});

async function getStaffActivities(
  dateRange: any,
  search?: string,
  sortOptions?: { sortBy?: string; sortOrder?: 'asc' | 'desc' },
  offset: number = 0,
  limit: number = 20
) {
  const whereClause = buildWhereClause(dateRange, search);

  const activities = await prisma.staffActivityLog.findMany({
    where: whereClause,
    select: {
      log_id: true,
      action: true,
      details: true,
      ip_address: true,
      created_at: true,
      staff: {
        select: {
          staff_id: true,
          user: {
            select: {
              first_name: true,
              last_name: true,
              email: true
            }
          }
        }
      }
    },
    orderBy: [
      { [sortOptions?.sortBy || 'created_at']: sortOptions?.sortOrder || 'desc' }
    ],
    skip: offset,
    take: limit
  });

  // Transform data for response
  return activities.map(activity => ({
    log_id: activity.log_id,
    staff_name: `${activity.staff.user.first_name} ${activity.staff.user.last_name}`.trim(),
    staff_email: activity.staff.user.email,
    action: activity.action,
    details: activity.details,
    ip_address: activity.ip_address,
    created_at: activity.created_at,
    time_ago: getTimeAgo(activity.created_at)
  }));
}

async function getStaffActivitiesCount(dateRange: any, search?: string): Promise<number> {
  const whereClause = buildWhereClause(dateRange, search);

  return await prisma.staffActivityLog.count({
    where: whereClause
  });
}

function buildWhereClause(dateRange: any, search?: string): any {
  const whereClause: any = {
    created_at: {
      gte: dateRange.start,
      lte: dateRange.end
    }
  };

  // Search functionality
  if (search) {
    whereClause.OR = [
      {
        action: {
          contains: search,
          mode: 'insensitive'
        }
      },
      {
        staff: {
          user: {
            first_name: {
              contains: search,
              mode: 'insensitive'
            }
          }
        }
      },
      {
        staff: {
          user: {
            last_name: {
              contains: search,
              mode: 'insensitive'
            }
          }
        }
      },
      {
        staff: {
          user: {
            email: {
              contains: search,
              mode: 'insensitive'
            }
          }
        }
      }
    ];
  }

  return whereClause;
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  } else {
    return date.toLocaleDateString();
  }
}
