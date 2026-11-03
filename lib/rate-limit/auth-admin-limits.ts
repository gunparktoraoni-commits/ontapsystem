import { NextRequest } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

export const ADMIN_AUTH_RATE_LIMITS = {
  LOGIN: { limit: 10, window: 900, action: "auth-admin-login" },
  FORGOT_PASSWORD: { limit: 5, window: 900, action: "auth-admin-forgot-password" },
  RESET_PASSWORD: { limit: 5, window: 900, action: "auth-admin-reset-password" },
  REFRESH_TOKEN: { limit: 20, window: 900, action: "auth-admin-refresh" },
  CHANGE_PASSWORD: { limit: 5, window: 900, action: "auth-admin-change-password" },
  VERIFY: { limit: 60, window: 60, action: "auth-admin-verify" },
  LOGOUT: { limit: 30, window: 60, action: "auth-admin-logout" },
} as const;

export interface AdminAuthRateLimitResult {
  success: boolean;
  retryAfter?: number;
  remaining: number;
}

export function checkAdminAuthRateLimit(
  req: NextRequest,
  endpoint: keyof typeof ADMIN_AUTH_RATE_LIMITS,
  actorKey?: string
): AdminAuthRateLimitResult {
  const config = ADMIN_AUTH_RATE_LIMITS[endpoint];
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
