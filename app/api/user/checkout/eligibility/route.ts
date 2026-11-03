import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getRequestId } from "@/lib/errors/http";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("user-checkout-eligibility", ip);
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
    const userId = BigInt(resolved.session.userId);
    const orderCount = await prisma.shopOrder.count({ where: { user_id: userId } });

    return NextResponse.json({
      success: true,
      data: {
        affiliate_eligible: orderCount === 0,
        has_any_order: orderCount > 0,
      },
      meta: { requestId },
    });
  } catch (error) {
    console.error("[USER_CHECKOUT_ELIGIBILITY] Failed", { requestId, error });
    return NextResponse.json(
      {
        success: false,
        error: "Failed to load checkout eligibility.",
        code: "USER_CHECKOUT_ELIGIBILITY_FAILED",
        tag: "[USER_CHECKOUT_ELIGIBILITY]",
      },
      { status: 500 },
    );
  }
}
