import { NextRequest } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

export const CLIENT_RATE_LIMITS = {
  SUMMARY: { limit: 30, window: 60, action: "superadmin-clients-summary" },
  LIST: { limit: 60, window: 60, action: "superadmin-clients-list" },
  ONLINE: { limit: 30, window: 60, action: "superadmin-clients-online" },
  DETAIL: { limit: 120, window: 60, action: "superadmin-clients-detail" },
  UPDATE: { limit: 30, window: 60, action: "superadmin-clients-update" },
  RESTRICT: { limit: 10, window: 60, action: "superadmin-clients-restrict" },
  UNRESTRICT: { limit: 10, window: 60, action: "superadmin-clients-unrestrict" },
  PORTFOLIO: { limit: 30, window: 60, action: "superadmin-clients-portfolio" },
  EXPORT: { limit: 5, window: 3600, action: "superadmin-clients-export" },
} as const;

export interface ClientRateLimitResult {
  success: boolean;
  retryAfter?: number;
  remaining: number;
}

export function checkClientRateLimit(
  req: NextRequest,
  endpoint: keyof typeof CLIENT_RATE_LIMITS,
  actorKey?: string
): ClientRateLimitResult {
  const config = CLIENT_RATE_LIMITS[endpoint];
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
