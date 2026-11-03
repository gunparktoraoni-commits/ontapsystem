import { NextRequest } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

export const SUPERADMIN_COMPANY_RATE_LIMITS = {
  LIST: { limit: 60, window: 60, action: "superadmin-companies-list" },
  DETAIL: { limit: 120, window: 60, action: "superadmin-companies-detail" },
  EXPORT: { limit: 5, window: 3600, action: "superadmin-companies-export" },
  PENDING_REQUESTS: { limit: 60, window: 60, action: "superadmin-companies-pending-requests" },
  APPROVE: { limit: 30, window: 60, action: "superadmin-companies-approve" },
  NAME_CHANGE_PENDING: { limit: 60, window: 60, action: "superadmin-companies-name-change-pending" },
  NAME_CHANGE_APPROVE: { limit: 30, window: 60, action: "superadmin-companies-name-change-approve" },
  EMPLOYEES_LIST: { limit: 60, window: 60, action: "superadmin-companies-employees-list" },
  EMPLOYEE_ROLE_UPDATE: { limit: 30, window: 60, action: "superadmin-companies-employee-role-update" },
  EMPLOYEE_RESTRICT: { limit: 20, window: 60, action: "superadmin-companies-employee-restrict" },
  ADMIN_TRANSFER: { limit: 20, window: 60, action: "superadmin-companies-admin-transfer" },
  SETTINGS_UPDATE: { limit: 20, window: 3600, action: "superadmin-companies-settings-update" },
  THEME_UPDATE: { limit: 20, window: 3600, action: "superadmin-companies-theme-update" },
  IMPERSONATION_START: { limit: 10, window: 3600, action: "superadmin-companies-impersonation-start" },
  IMPERSONATION_STATUS: { limit: 120, window: 60, action: "superadmin-companies-impersonation-status" },
  IMPERSONATION_END: { limit: 60, window: 60, action: "superadmin-companies-impersonation-end" },
  COMPANY_RESTRICT: { limit: 10, window: 60, action: "superadmin-companies-restrict" },
} as const;

export interface SuperadminCompanyRateLimitResult {
  success: boolean;
  retryAfter?: number;
  remaining: number;
}

export function checkSuperadminCompanyRateLimit(
  req: NextRequest,
  endpoint: keyof typeof SUPERADMIN_COMPANY_RATE_LIMITS,
  actorKey?: string
): SuperadminCompanyRateLimitResult {
  const config = SUPERADMIN_COMPANY_RATE_LIMITS[endpoint];
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
