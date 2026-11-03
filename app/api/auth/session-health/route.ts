import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

function logSessionHealthError(err: unknown): void {
  const prismaCode =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code)
      : undefined;
  const message = err instanceof Error ? err.message : String(err);
  console.error("[auth/session-health] Unhandled error:", { prismaCode, message, err });
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    const rateCheck = checkRateLimit("session-health", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many session checks. Please slow down." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      );
    }

    const resolved = await resolveRequestSession(request);
    const session = resolved.session;
    if (!session) {
      return NextResponse.json(
        {
          authenticated: false,
          valid: false,
          refreshed: false,
          requiresAuth: true,
          error: "No active session.",
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        authenticated: true,
        valid: true,
        refreshed: resolved.refreshed,
        session: {
          userId: session.userId,
          email: session.email,
          role: session.role,
          sessionId: session.sessionId,
          rememberMe: session.rememberMe,
          expiresAt: session.expiresAt,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    logSessionHealthError(err);
    return NextResponse.json(
      {
        authenticated: false,
        valid: false,
        refreshed: false,
        requiresAuth: true,
        error: "Session check unavailable.",
      },
      { status: 200 }
    );
  }
}
