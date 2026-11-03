import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getRequestId } from "@/lib/errors/http";
import {
  revokeUserSession,
  UserSessionError,
} from "@/lib/services/user-session.service";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("user-sessions-revoke", ip);
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

  const { sessionId } = await params;
  const trimmedSessionId = sessionId?.trim();
  if (!trimmedSessionId) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid session ID.",
        code: "USER_SESSION_NOT_FOUND",
        tag: "[USER_SESSIONS_API]",
      },
      { status: 400 },
    );
  }

  try {
    await revokeUserSession(
      resolved.session.userId,
      trimmedSessionId,
      String(resolved.session.sessionId),
    );

    return NextResponse.json({
      success: true,
      message: "Session revoked.",
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

    console.error("[USER_SESSIONS_API] Failed to revoke session", {
      requestId,
      sessionId: trimmedSessionId,
      error,
    });
    return NextResponse.json(
      {
        success: false,
        error: "Failed to revoke session.",
        code: "USER_SESSION_REVOKE_FAILED",
        tag: "[USER_SESSIONS_API]",
      },
      { status: 500 },
    );
  }
}
