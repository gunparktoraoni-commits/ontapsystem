// ──────────────────────────────────────────────────────────────
// POST /api/auth/logout — Secure Logout Endpoint
// ──────────────────────────────────────────────────────────────
// Revokes the session in the database AND clears cookies.
// Even if the cookie is somehow retained (cached proxy, etc.),
// the server-side session is marked revoked and will be rejected.
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import {
  destroySession,
  getSession,
  logAuditEvent,
  getClientIp,
  getUserAgent,
  revokeAllSessions,
} from "@/server/lib/auth";
import { isCrossPortalSuperadminRole } from "@/server/lib/cross-portal-sso-policy";
import { withPerformanceTracking } from "@/middleware/performance";
import { SuperadminSettingsService } from "@/lib/services/superadmin-settings.service";

export async function POST(request: NextRequest) {
  return withPerformanceTracking(request, async () => {
    const ip = getClientIp(request);
    const ua = getUserAgent(request);

    try {
      const session = await getSession();
      await destroySession();

      if (session) {
        // Superadmin sessions are shared with SmartPet; signing out ends them everywhere.
        if (isCrossPortalSuperadminRole(session.role)) {
          await revokeAllSessions(session.userId);
        }

        if (session.role.toLowerCase() === "super_admin") {
          const settingsService = new SuperadminSettingsService(`logout:${session.userId}`);
          settingsService.markLogoutBySession(String(session.sessionId)).catch((error) => {
            console.error("Superadmin logout tracking failed:", error);
          });
        }

        await logAuditEvent("LOGOUT", session.userId, ip, ua);
      }

      return NextResponse.json(
        { message: "Logged out successfully." },
        { status: 200 }
      );
    } catch (error) {
      console.error("Logout error:", error);
      return NextResponse.json(
        { error: "Internal server error." },
        { status: 500 }
      );
    }
  });
}
