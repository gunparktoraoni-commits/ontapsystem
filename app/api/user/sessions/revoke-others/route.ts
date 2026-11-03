import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getRequestId } from "@/lib/errors/http";
import {
  revokeAllOtherUserSessions,
  UserSessionError,
} from "@/lib/services/user-session.service";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("user-sessions-revoke-others", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
      },
    );
  }

  const resolved = await resolveRequestSession(request);
  if (!resolved.session) {
    return NextResponse.json(
      { success: false, error: "Authentication required.", requiresAuth: true },
      { status: 401 },
    );
  }

  try {
    const revokedCount = await revokeAllOtherUserSessions(
      resolved.session.userId,
      String(resolved.session.sessionId),
    );

    return NextResponse.json({
      success: true,
      data: { revoked_count: revokedCount },
      message: "Other sessions revoked.",
      meta: { requestId },
    });
  } catch (error) {
    if (error instanceof UserSessionError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          code: error.code,
          tag: "[USER_SESSIONS_API]",
        },
        { status: error.status },
      );
    }

    console.error("[USER_SESSIONS_API] Failed to revoke other sessions", { requestId, error });
    return NextResponse.json(
      {
        success: false,
        error: "Failed to revoke other sessions.",
        code: "USER_SESSION_REVOKE_FAILED",
        tag: "[USER_SESSIONS_API]",
      },
      { status: 500 },
    );
  }
}
