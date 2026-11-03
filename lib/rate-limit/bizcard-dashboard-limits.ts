import { NextRequest } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

export const BIZCARD_DASHBOARD_RATE_LIMITS = {
  GET_BIZCARD_LIST: { limit: 60, window: 60, action: "user-bizcards-list" },
  GET_DASHBOARD: { limit: 60, window: 60, action: "user-bizcard-dashboard" },
  GET_DASHBOARD_BY_ID: { limit: 120, window: 60, action: "user-bizcard-dashboard-by-id" },
} as const;

export interface BizcardDashboardRateLimitResult {
  success: boolean;
  retryAfter?: number;
  remaining: number;
}

export function checkBizcardDashboardRateLimit(
  req: NextRequest,
  endpoint: keyof typeof BIZCARD_DASHBOARD_RATE_LIMITS,
  actorKey?: string
): BizcardDashboardRateLimitResult {
  const config = BIZCARD_DASHBOARD_RATE_LIMITS[endpoint];
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
