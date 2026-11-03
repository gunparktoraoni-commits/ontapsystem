import { NextRequest } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

export const ORDER_RATE_LIMITS = {
  SUMMARY: { limit: 30, window: 60, action: "superadmin-orders-summary" },
  LIST: { limit: 60, window: 60, action: "superadmin-orders-list" },
  RECENT: { limit: 60, window: 60, action: "superadmin-orders-recent" },
  DETAIL: { limit: 120, window: 60, action: "superadmin-orders-detail" },
  UPDATE_STATUS: { limit: 30, window: 60, action: "superadmin-orders-status-update" },
  CANCEL: { limit: 30, window: 60, action: "superadmin-orders-cancel" },
  TIMELINE: { limit: 60, window: 60, action: "superadmin-orders-timeline" },
  ANALYTICS: { limit: 30, window: 60, action: "superadmin-orders-analytics" },
  EXPORT: { limit: 5, window: 3600, action: "superadmin-orders-export" },
  PDF_REPORT: { limit: 5, window: 3600, action: "superadmin-orders-report-pdf" },
  STREAM: { limit: 30, window: 60, action: "superadmin-orders-stream" },
  BULK_UPDATE: { limit: 10, window: 60, action: "superadmin-orders-bulk-update" },
  BULK_DELETE: { limit: 10, window: 60, action: "superadmin-orders-bulk-delete" },
} as const;

export interface OrderRateLimitResult {
  success: boolean;
  retryAfter?: number;
  remaining: number;
}

export function checkOrderRateLimit(
  req: NextRequest,
  endpoint: keyof typeof ORDER_RATE_LIMITS,
  actorKey?: string
): OrderRateLimitResult {
  const config = ORDER_RATE_LIMITS[endpoint];
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
