import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { CartErrorCode } from "@/lib/services/cart.service";

export async function requireCartSession(request: NextRequest) {
  const result = await resolveRequestSession(request);
  if (!result.session) {
    return NextResponse.json(
      {
        success: false,
        error: "Authentication required.",
        code: CartErrorCode.UNAUTHORIZED,
        requiresAuth: true,
      },
      { status: 401 }
    );
  }

  return result.session;
}

export function checkCartRateLimit(action: string, userId: bigint) {
  return checkRateLimit(action, `user:${userId.toString()}`);
}

export function mapCartError(error: unknown) {
  const code = error instanceof Error ? error.message : "";

  switch (code) {
    case CartErrorCode.PRODUCT_NOT_FOUND:
      return NextResponse.json({ success: false, error: "Product not found.", code }, { status: 404 });
    case CartErrorCode.PRODUCT_OUT_OF_STOCK:
      return NextResponse.json({ success: false, error: "Product is out of stock.", code }, { status: 409 });
    case CartErrorCode.INVALID_QUANTITY:
      return NextResponse.json({ success: false, error: "Invalid quantity.", code }, { status: 400 });
    case CartErrorCode.ITEM_NOT_IN_CART:
      return NextResponse.json({ success: false, error: "Item not in cart.", code }, { status: 404 });
    case CartErrorCode.CART_EMPTY:
      return NextResponse.json({ success: false, error: "Cart is empty.", code }, { status: 404 });
    case CartErrorCode.RATE_LIMIT_EXCEEDED:
      return NextResponse.json({ success: false, error: "Rate limit exceeded.", code }, { status: 429 });
    default:
      return NextResponse.json({ success: false, error: "An unexpected error occurred." }, { status: 500 });
  }
}
