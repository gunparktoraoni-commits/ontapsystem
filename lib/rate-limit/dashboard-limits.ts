import { NextRequest } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

export const DASHBOARD_RATE_LIMITS = {
  SUMMARY: { limit: 30, window: 60, action: "company-dashboard-summary" },
  WEEKLY_TREND: { limit: 30, window: 60, action: "company-dashboard-weekly-trend" },
  TOP_EMPLOYEE: { limit: 60, window: 60, action: "company-dashboard-top-employee" },
  TIME_SERIES: { limit: 20, window: 60, action: "company-dashboard-time-series" },
  EMPLOYEE_RANKINGS: { limit: 30, window: 60, action: "company-dashboard-employee-rankings" },
} as const;

export interface DashboardRateLimitResult {
  success: boolean;
  retryAfter?: number;
  remaining: number;
}

export async function checkDashboardRateLimit(
  req: NextRequest,
  endpoint: keyof typeof DASHBOARD_RATE_LIMITS
): Promise<DashboardRateLimitResult> {
  const config = DASHBOARD_RATE_LIMITS[endpoint];
  const ip = getClientIp(req);
  const result = checkRateLimit(config.action, ip);

  if (!result.allowed) {
    return {
      success: false,
      retryAfter: Math.ceil(result.retryAfterMs / 1000),
      remaining: 0,
    };
  }

  return {
    success: true,
    remaining: result.remaining,
  };
}
