import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getCartForUser } from "@/lib/services/cart.service";
import { checkCartRateLimit, requireCartSession } from "@/lib/cart/cart-route-utils";

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const session = await requireCartSession(request);
  if (session instanceof NextResponse) {
    return session;
  }

  const rateCheck = checkCartRateLimit("cart-get", BigInt(session.userId));
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { success: false, error: "Rate limit exceeded.", code: "CART_24400" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const cart = await getCartForUser(BigInt(session.userId));

  return NextResponse.json({
    success: true,
    data: cart,
    meta: {
      requestId: randomUUID(),
      responseTime: Date.now() - startedAt,
    },
  });
}
