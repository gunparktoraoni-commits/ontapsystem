import { NextRequest } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

export const STAFF_MGMT_RATE_LIMITS = {
  ANALYTICS: { limit: 30, window: 60, action: "superadmin-staff-analytics" },
  LIST: { limit: 60, window: 60, action: "superadmin-staff-list" },
  DETAIL: { limit: 120, window: 60, action: "superadmin-staff-detail" },
  CREATE: { limit: 10, window: 60, action: "superadmin-staff-create" },
  UPDATE_PERMISSIONS: { limit: 20, window: 60, action: "superadmin-staff-update-permissions" },
  UPDATE_ROLE: { limit: 20, window: 60, action: "superadmin-staff-update-role" },
  UPDATE_STATUS: { limit: 20, window: 60, action: "superadmin-staff-update-status" },
  DELETE: { limit: 10, window: 60, action: "superadmin-staff-delete" },
  SEARCH: { limit: 60, window: 60, action: "superadmin-staff-search" },
  ASSIGN: { limit: 10, window: 60, action: "superadmin-staff-assign" },
  ASSIGN_CLIENT: { limit: 30, window: 60, action: "superadmin-staff-assign-client" },
  FOR_ASSIGNMENT: { limit: 60, window: 60, action: "superadmin-staff-for-assignment" },
  EXPORT: { limit: 5, window: 3600, action: "superadmin-staff-export" },
} as const;

export interface StaffMgmtRateLimitResult {
  success: boolean;
  retryAfter?: number;
  remaining: number;
}

export function checkStaffMgmtRateLimit(
  req: NextRequest,
  endpoint: keyof typeof STAFF_MGMT_RATE_LIMITS,
  actorKey?: string
): StaffMgmtRateLimitResult {
  const config = STAFF_MGMT_RATE_LIMITS[endpoint];
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
