import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getRequestId } from "@/lib/errors/http";
import { listUserActiveSessions } from "@/lib/services/user-session.service";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, value) => (typeof value === "bigint" ? value.toString() : value)));

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("user-sessions-list", ip);
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
    const currentSessionId = String(resolved.session.sessionId);
    const sessions = await listUserActiveSessions(resolved.session.userId, currentSessionId);

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          sessions: sessions.map((session) => ({
            session_id: session.session_id,
            device_type: session.device_type,
            browser: session.browser,
            os: session.os,
            ip_address: session.ip_address,
            location: session.location,
            created_at: session.created_at.toISOString(),
            last_activity: session.last_activity?.toISOString() ?? null,
            is_current: session.is_current,
          })),
        },
        meta: { requestId },
      }),
    );
  } catch (error) {
    console.error("[USER_SESSIONS_API] Failed to list sessions", { requestId, error });
    return NextResponse.json(
      {
        success: false,
        error: "Failed to load sessions.",
        code: "USER_SESSION_LIST_FAILED",
        tag: "[USER_SESSIONS_API]",
      },
      { status: 500 },
    );
  }
}
