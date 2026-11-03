import { NextRequest } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

export const SUPERADMIN_SETTINGS_RATE_LIMITS = {
  PROFILE_READ: { limit: 120, window: 60, action: "superadmin-settings-profile-read" },
  PROFILE_UPDATE: { limit: 20, window: 3600, action: "superadmin-settings-profile-update" },
  CHANGE_PASSWORD: { limit: 5, window: 900, action: "superadmin-settings-change-password" },

  SECURITY_READ: { limit: 60, window: 60, action: "superadmin-settings-security-read" },
  SECURITY_UPDATE: { limit: 20, window: 3600, action: "superadmin-settings-security-update" },
  TWO_FACTOR_SETUP: { limit: 10, window: 3600, action: "superadmin-settings-2fa-setup" },
  TWO_FACTOR_ENABLE: { limit: 10, window: 3600, action: "superadmin-settings-2fa-enable" },
  TWO_FACTOR_DISABLE: { limit: 10, window: 3600, action: "superadmin-settings-2fa-disable" },

  LOGIN_HISTORY_READ: { limit: 60, window: 60, action: "superadmin-settings-login-history-read" },
  LOGIN_HISTORY_EXPORT: { limit: 5, window: 3600, action: "superadmin-settings-login-history-export" },
  ACTIVE_SESSIONS_READ: { limit: 60, window: 60, action: "superadmin-settings-active-sessions-read" },
  SESSION_REVOKE: { limit: 30, window: 60, action: "superadmin-settings-session-revoke" },
  SESSION_REVOKE_ALL: { limit: 10, window: 3600, action: "superadmin-settings-session-revoke-all" },

  NOTIFICATIONS_READ: { limit: 120, window: 60, action: "superadmin-settings-notifications-read" },
  NOTIFICATIONS_UPDATE: { limit: 20, window: 3600, action: "superadmin-settings-notifications-update" },

  PAYMENT_CHANNELS_READ: { limit: 60, window: 60, action: "superadmin-settings-payment-channels-read" },
  PAYMENT_CHANNELS_CREATE: { limit: 20, window: 3600, action: "superadmin-settings-payment-channels-create" },
  PAYMENT_CHANNELS_UPDATE: { limit: 20, window: 3600, action: "superadmin-settings-payment-channels-update" },
  PAYMENT_CHANNELS_DELETE: { limit: 20, window: 3600, action: "superadmin-settings-payment-channels-delete" },
  PAYMENT_CHANNELS_SET_DEFAULT: { limit: 30, window: 3600, action: "superadmin-settings-payment-channels-set-default" },
} as const;

export interface SuperadminSettingsRateLimitResult {
  success: boolean;
  retryAfter?: number;
  remaining: number;
}

export function checkSuperadminSettingsRateLimit(
  req: NextRequest,
  endpoint: keyof typeof SUPERADMIN_SETTINGS_RATE_LIMITS,
  actorKey?: string
): SuperadminSettingsRateLimitResult {
  const config = SUPERADMIN_SETTINGS_RATE_LIMITS[endpoint];
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
