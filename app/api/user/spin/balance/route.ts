// GET /api/user/spin/balance
// Auth required — returns user's current spin balance and statistics.
// Rate limit: 60/min per IP.

import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { RouletteService } from "@/lib/services/roulette.service";
import { generateRequestId } from "@/lib/utils/request-utils";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export async function GET(request: NextRequest) {
  const requestId = generateRequestId();
  const ip = getClientIp(request);

  // Rate limiting check
  const rateCheck = checkRateLimit("user-spin-balance", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RATE_LIMIT",
          message: "Too many requests. Please slow down.",
          retry_after: Math.ceil(rateCheck.retryAfterMs / 1000),
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  // Authentication check
  const resolved = await resolveRequestSession(request);
  if (!resolved.session) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Authentication required.", requiresAuth: true },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status: 401 }
    );
  }

  try {
    const service = new RouletteService(requestId);
    const balance = await service.getSpinBalance(resolved.session.userId);

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          balance: balance.balance,
          total_earned: balance.totalEarned,
          total_used: balance.totalUsed,
        },
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
        },
      })
    );
  } catch (error) {
    console.error("[Spin Balance] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to fetch spin balance",
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status: 500 }
    );
  }
}
