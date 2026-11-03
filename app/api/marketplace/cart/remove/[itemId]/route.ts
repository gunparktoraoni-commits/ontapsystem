// DELETE /api/marketplace/cart/remove/[itemId]
// Auth required — removes a specific item from the cart.
// Rate limit: 60/min per IP.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { validateCsrfToken } from "@/lib/csrf";

async function requireSession(request: NextRequest) {
  const result = await resolveRequestSession(request);
  if (!result.session) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Authentication required.", requiresAuth: true },
        { status: 401 }
      ),
    };
  }
  return { ok: true as const, session: result.session };
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("marketplace-cart-remove", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const csrfValid = await validateCsrfToken(request);
  if (!csrfValid) {
    return NextResponse.json(
      { error: "CSRF validation failed.", code: "INVALID_CSRF_TOKEN" },
      { status: 403 }
    );
  }

  const { session } = auth;

  try {
    const { itemId: rawItemId } = await params;
    let cartItemId: bigint;
    try {
      cartItemId = BigInt(rawItemId);
    } catch {
      return NextResponse.json({ success: false, error: "Invalid cart item ID." }, { status: 400 });
    }

    const userId = BigInt(session.userId);

    const existing = await prisma.cartItem.findFirst({
      where: { id: cartItemId, user_id: userId },
    });

    if (!existing) {
      return NextResponse.json({ success: false, error: "Cart item not found." }, { status: 404 });
    }

    await prisma.cartItem.delete({ where: { id: cartItemId } });

    return NextResponse.json({ success: true, message: "Item removed from cart." });
  } catch (err) {
    console.error("[marketplace/cart/remove/[itemId] DELETE]", err);
    return NextResponse.json({ success: false, error: "An unexpected error occurred." }, { status: 500 });
  }
}
