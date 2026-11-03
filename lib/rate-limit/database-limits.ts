import { NextRequest } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

export const DATABASE_RECONCILE_RATE_LIMITS = {
  COMPARE: { limit: 5, window: 3600, action: "superadmin-database-reconcile-compare" },
  FIX: { limit: 2, window: 3600, action: "superadmin-database-reconcile-fix" },
} as const;

export interface DatabaseReconcileRateLimitResult {
  success: boolean;
  retryAfter?: number;
  remaining: number;
}

export function checkDatabaseReconcileRateLimit(
  req: NextRequest,
  endpoint: keyof typeof DATABASE_RECONCILE_RATE_LIMITS,
  actorKey?: string
): DatabaseReconcileRateLimitResult {
  const config = DATABASE_RECONCILE_RATE_LIMITS[endpoint];
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
