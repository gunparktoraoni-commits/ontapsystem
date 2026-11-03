// ──────────────────────────────────────────────────────────────
// POST /api/auth/refresh — Token Refresh Endpoint
// ──────────────────────────────────────────────────────────────
// Implements refresh token rotation:
// 1. Client sends refresh_token cookie (httpOnly, set automatically)
// 2. Server validates the refresh token against the DB
// 3. Old session is revoked
// 4. New access + refresh tokens are issued
// 5. New cookies are set
//
// THEFT DETECTION:
// If a revoked refresh token is reused (indicating potential theft),
// ALL sessions for that user are revoked — forcing re-auth everywhere.
// This is based on the RFC 6749 refresh token rotation pattern.
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import {
  refreshSession,
  logAuditEvent,
  getClientIp,
  getUserAgent,
} from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { SuperadminSettingsService } from "@/lib/services/superadmin-settings.service";
import { extractGeoMetadata } from "@/server/lib/analytics";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);
  const geo = extractGeoMetadata(request);
  const location = geo.city && geo.country ? `${geo.city}, ${geo.country}` : geo.country ?? null;

  try {
    // ── Rate Limiting ──────────────────────────────
    const rateCheck = checkRateLimit("refresh", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many refresh attempts. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    const result = await refreshSession({ ip, userAgent: ua });

    if (!result.success) {
      await logAuditEvent("REFRESH_FAILED", undefined, ip, ua, {
        error: result.error,
      });

      return NextResponse.json(
        { error: result.error },
        { status: 401 }
      );
    }

    if (result.session?.role.toLowerCase() === "super_admin") {
      const settingsService = new SuperadminSettingsService(`refresh:${result.session.userId}`);

      const trackingTasks: Array<Promise<unknown>> = [
        settingsService.recordLogin({
          userId: result.session.userId,
          sessionId: String(result.session.sessionId),
          userAgent: ua,
          ipAddress: ip,
          location,
          latitude: geo.latitude,
          longitude: geo.longitude,
        }),
      ];

      if (result.rotatedFromSessionId) {
        trackingTasks.push(settingsService.markLogoutBySession(String(result.rotatedFromSessionId)));
      }

      Promise.all(trackingTasks).catch((error) => {
        console.error("Superadmin refresh tracking failed:", error);
      });
    }

    await logAuditEvent("REFRESH_SUCCESS", undefined, ip, ua);

    return NextResponse.json(
      { message: "Session refreshed successfully." },
      { status: 200 }
    );
  } catch (error) {
    console.error("Refresh error:", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
