import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { CartErrorCode, removeCartItem, updateCartItemQuantity } from "@/lib/services/cart.service";
import { checkCartRateLimit, requireCartSession } from "@/lib/cart/cart-route-utils";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const startedAt = Date.now();
  const session = await requireCartSession(request);
  if (session instanceof NextResponse) return session;

  const rateCheck = checkCartRateLimit("cart-update", BigInt(session.userId));
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { success: false, error: "Rate limit exceeded.", code: CartErrorCode.RATE_LIMIT_EXCEEDED },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const { itemId } = await params;
  let cartItemId: bigint;
  try {
    cartItemId = BigInt(itemId);
  } catch {
    return NextResponse.json({ success: false, error: "Invalid cart item ID.", code: CartErrorCode.ITEM_NOT_IN_CART }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ success: false, error: "Invalid request payload." }, { status: 400 });
  }

  const quantity = Number((body as { quantity?: unknown }).quantity);
  try {
    const result = await updateCartItemQuantity(BigInt(session.userId), cartItemId, quantity);
    return NextResponse.json({
      success: true,
      data: result,
      meta: { requestId: randomUUID(), responseTime: Date.now() - startedAt },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = code === CartErrorCode.ITEM_NOT_IN_CART ? 404 : code === CartErrorCode.PRODUCT_OUT_OF_STOCK ? 409 : 400;
    return NextResponse.json(
      { success: false, error: code === CartErrorCode.ITEM_NOT_IN_CART ? "Item not in cart." : code === CartErrorCode.INVALID_QUANTITY ? "Invalid quantity." : "Unable to update item.", code },
      { status }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const startedAt = Date.now();
  const session = await requireCartSession(request);
  if (session instanceof NextResponse) return session;

  const rateCheck = checkCartRateLimit("cart-remove", BigInt(session.userId));
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { success: false, error: "Rate limit exceeded.", code: CartErrorCode.RATE_LIMIT_EXCEEDED },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const { itemId } = await params;
  let cartItemId: bigint;
  try {
    cartItemId = BigInt(itemId);
  } catch {
    return NextResponse.json({ success: false, error: "Invalid cart item ID.", code: CartErrorCode.ITEM_NOT_IN_CART }, { status: 400 });
  }

  try {
    const cartSummary = await removeCartItem(BigInt(session.userId), cartItemId);
    return NextResponse.json({
      success: true,
      message: "Item removed",
      data: { cartSummary },
      meta: { requestId: randomUUID(), responseTime: Date.now() - startedAt },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return NextResponse.json(
      { success: false, error: code === CartErrorCode.ITEM_NOT_IN_CART ? "Item not in cart." : "Unable to remove item.", code },
      { status: code === CartErrorCode.ITEM_NOT_IN_CART ? 404 : 400 }
    );
  }
}
