import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { generateRequestId } from "@/lib/utils/request-utils";
import { getUserRewardsPayload } from "@/server/lib/growth-rewards";

const serialize = (obj: unknown): unknown =>
  JSON.parse(
    JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );

export async function GET(request: NextRequest) {
  const requestId = generateRequestId();
  const started = Date.now();
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("user-rewards", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)),
        },
      },
    );
  }

  const auth = await resolveRequestSession(request);
  if (!auth.session) {
    return NextResponse.json(
      { error: "Authentication required.", requiresAuth: true },
      { status: 401 },
    );
  }

  try {
    const data = await getUserRewardsPayload(auth.session.userId);
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
    console.error("[user/rewards] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "REWARDS_FETCH_FAILED",
          message: "Unable to load rewards.",
          requestId,
        },
        meta: { requestId, responseTime: Date.now() - started },
      },
      { status: 500 },
    );
  }
}
