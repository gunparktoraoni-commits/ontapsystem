// GET /api/user/spin/history
// Auth required — returns user's spin history.
// Rate limit: 60/min per IP.
// Query params: limit (default: 20, max: 100)

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
  const rateCheck = checkRateLimit("user-spin-history", ip);
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

  // Parse query params
  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitParam || "20", 10) || 20, 1), 100);

  try {
    const service = new RouletteService(requestId);
    const history = await service.getSpinHistory(resolved.session.userId, limit);

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          history: history.map((h) => ({
            spin_id: h.spinId,
            prize_type: h.prizeType,
            prize_value: h.prizeValue,
            discount_percentage: h.discountPercentage,
            voucher_code: h.voucherCode,
            source: h.source,
            created_at: h.createdAt.toISOString(),
          })),
          count: history.length,
          limit,
        },
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
        },
      })
    );
  } catch (error) {
    console.error("[Spin History] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to fetch spin history",
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status: 500 }
    );
  }
}
