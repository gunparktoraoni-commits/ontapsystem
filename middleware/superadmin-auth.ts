// ──────────────────────────────────────────────────────────────
// Superadmin Authentication Middleware
// ──────────────────────────────────────────────────────────────
// Provides authentication and authorization for superadmin endpoints
// Includes rate limiting and request tracking
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/server/lib/auth";
import {
  SuperAdminDashboardErrorCode,
  createSuperAdminError,
} from "@/lib/errors/superadmin-dashboard-errors";
import { prisma } from "@/server/lib/prisma";

// Rate limiting configuration
const RATE_LIMITS = {
  DASHBOARD_METRICS: { limit: 30, window: 60 },
  USERS: { limit: 60, window: 60 },
  SYSTEM_HEALTH: { limit: 20, window: 60 },
  STAFF_ACTIVITIES: { limit: 60, window: 60 },
  RECENT_ORDERS: { limit: 60, window: 60 },
  USER_LOCATIONS: { limit: 30, window: 60 },
};

// In-memory rate limiting store (production should use Redis)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

/**
 * Check if user is superadmin
 */
async function isSuperAdmin(userId: number): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      where: { user_id: BigInt(userId) },
      select: { role: true },
    });

    return user?.role === "super_admin" || user?.role === "dev";
  } catch (error) {
    console.error("Error checking superadmin role:", error);
    return false;
  }
}

/**
 * Check rate limit for specific action
 */
export async function checkSuperadminDashboardRateLimit(
  req: NextRequest,
  action: keyof typeof RATE_LIMITS
): Promise<{ allowed: boolean; remaining?: number }> {
  const config = RATE_LIMITS[action];
  if (!config) {
    return { allowed: true };
  }

  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
  const key = `${action}:${ip}`;
  const now = Date.now();

  for (const [storeKey, data] of rateLimitStore.entries()) {
    if (data.resetTime <= now) {
      rateLimitStore.delete(storeKey);
    }
  }

  const current = rateLimitStore.get(key);

  if (!current || current.resetTime <= now) {
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + config.window * 1000,
    });
    return { allowed: true, remaining: config.limit - 1 };
  }

  if (current.count >= config.limit) {
    return { allowed: false, remaining: 0 };
  }

  current.count++;
  return { allowed: true, remaining: config.limit - current.count };
}

/**
 * Superadmin authentication middleware
 */
export function withDashboardSuperAdmin(
  handler: (req: NextRequest) => Promise<NextResponse>
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    try {
      const session = await getSession();

      if (!session) {
        return NextResponse.json(
          {
            success: false,
            error: createSuperAdminError(
              SuperAdminDashboardErrorCode.UNAUTHORIZED_ACCESS,
              "No session found"
            ),
          },
          { status: 401 }
        );
      }

      const isSuper = await isSuperAdmin(session.userId);

      if (!isSuper) {
        return NextResponse.json(
          {
            success: false,
            error: createSuperAdminError(
              SuperAdminDashboardErrorCode.SUPERADMIN_REQUIRED,
              "Superadmin privileges required"
            ),
          },
          { status: 403 }
        );
      }

      if (session.expiresAt <= new Date()) {
        return NextResponse.json(
          {
            success: false,
            error: createSuperAdminError(
              SuperAdminDashboardErrorCode.SESSION_EXPIRED,
              "Session has expired"
            ),
          },
          { status: 401 }
        );
      }

      return await handler(req);
    } catch (error) {
      console.error("Superadmin auth middleware error:", error);

      return NextResponse.json(
        {
          success: false,
          error: createSuperAdminError(
            SuperAdminDashboardErrorCode.DATABASE_ERROR,
            "Authentication error"
          ),
        },
        { status: 500 }
      );
    }
  };
}

export function getRateLimitStatus(): Record<string, { used: number; limit: number; window: number }> {
  const status: Record<string, any> = {};
  const now = Date.now();

  for (const [action, config] of Object.entries(RATE_LIMITS)) {
    let used = 0;
    for (const [key, data] of rateLimitStore.entries()) {
      if (key.startsWith(action + ":") && data.resetTime > now) {
        used = Math.max(used, data.count);
      }
    }
    status[action] = {
      used,
      limit: config.limit,
      window: config.window,
    };
  }

  return status;
}
