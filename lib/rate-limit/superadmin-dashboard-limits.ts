import { NextRequest } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

export const SUPERADMIN_DASHBOARD_RATE_LIMITS = {
  METRICS: { limit: 30, window: 60, action: "superadmin-dashboard-metrics" },
  RECENT_ACTIVITIES: { limit: 60, window: 60, action: "superadmin-dashboard-recent-activities" },
  USERS: { limit: 60, window: 60, action: "superadmin-users-list" },
  SYSTEM_HEALTH: { limit: 30, window: 60, action: "superadmin-system-health" },
  STAFF_ACTIVITIES: { limit: 30, window: 60, action: "superadmin-staff-activities" },
  RECENT_ORDERS: { limit: 60, window: 60, action: "superadmin-recent-orders" },
  USER_LOCATIONS: { limit: 30, window: 60, action: "superadmin-user-locations" },
} as const;

export interface SuperAdminDashboardRateLimitResult {
  success: boolean;
  retryAfter?: number;
  remaining: number;
}

export function checkSuperAdminDashboardRateLimit(
  req: NextRequest,
  endpoint: keyof typeof SUPERADMIN_DASHBOARD_RATE_LIMITS,
  actorKey?: string
): SuperAdminDashboardRateLimitResult {
  const config = SUPERADMIN_DASHBOARD_RATE_LIMITS[endpoint];
  const ip = getClientIp(req);
  const key = actorKey ? `${ip}:${actorKey}` : ip;

  const result = checkRateLimit(config.action, key);
  if (!result.allowed) {
    return {
      success: false,
      retryAfter: Math.max(1, Math.ceil(result.retryAfterMs / 1000)),
      remaining: 0,
    };
  }

  return {
    success: true,
    remaining: result.remaining,
  };
}
