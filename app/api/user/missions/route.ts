// GET /api/user/missions
// Auth required — returns the authenticated user's growth referral summary,
// mission progress (from QUALIFIED referrals), and referral activity.

import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { generateRequestId } from "@/lib/utils/request-utils";
import { getMissionsPayload } from "@/server/lib/growth-referral";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

async function requireSession(request: NextRequest) {
  const result = await resolveRequestSession(request);
  if (!result.session) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Authentication required.", requiresAuth: true },
        { status: 401 },
      ),
    };
  }
  return { ok: true as const, session: result.session };
}

export async function GET(request: NextRequest) {
  const requestId = generateRequestId();
  const started = Date.now();
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("user-missions", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
      },
    );
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const { session } = auth;

  try {
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL ||
      "https://ontap.com";

    const data = await getMissionsPayload(session.userId, appUrl);

    return NextResponse.json(
      serialize({
        success: true,
        data,
        meta: {
          requestId,
          responseTime: Date.now() - started,
          timestamp: new Date().toISOString(),
        },
      }),
    );
  } catch (error) {
    console.error("[user/missions] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "MISSIONS_FETCH_FAILED",
          message: "Unable to load missions data.",
          requestId,
        },
        meta: {
          requestId,
          responseTime: Date.now() - started,
        },
      },
      { status: 500 },
    );
  }
}
