import { NextRequest } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

export const AFFILIATE_RATE_LIMITS = {
  ANALYTICS: { limit: 30, window: 60, action: "superadmin-affiliates-analytics" },
  SUMMARY: { limit: 30, window: 60, action: "superadmin-affiliates-summary" },
  LIST: { limit: 60, window: 60, action: "superadmin-affiliates-list" },
  TOP_PERFORMERS: { limit: 30, window: 60, action: "superadmin-affiliates-top-performers" },
  RECENT_REFERRALS: { limit: 30, window: 60, action: "superadmin-affiliates-recent-referrals" },
  DETAIL: { limit: 120, window: 60, action: "superadmin-affiliates-detail" },
  UPDATE: { limit: 30, window: 60, action: "superadmin-affiliates-update" },
  UPDATE_COMMISSION: { limit: 30, window: 60, action: "superadmin-affiliates-update-commission" },
  RESTRICT: { limit: 10, window: 60, action: "superadmin-affiliates-restrict" },
  UNRESTRICT: { limit: 10, window: 60, action: "superadmin-affiliates-unrestrict" },
  PERFORMANCE: { limit: 60, window: 60, action: "superadmin-affiliates-performance" },
  EXPORT: { limit: 5, window: 3600, action: "superadmin-affiliates-export" },
} as const;

export interface AffiliateRateLimitResult {
  success: boolean;
  retryAfter?: number;
  remaining: number;
}

export function checkAffiliateRateLimit(
  req: NextRequest,
  endpoint: keyof typeof AFFILIATE_RATE_LIMITS,
  actorKey?: string
): AffiliateRateLimitResult {
  const config = AFFILIATE_RATE_LIMITS[endpoint];
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
