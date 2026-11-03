import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { batchRemoveCartItems, addMerchandiseToCart } from "@/lib/services/cart.service";
import { checkCartRateLimit, requireCartSession } from "@/lib/cart/cart-route-utils";

function parseItemIds(body: unknown): bigint[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const raw = (body as { itemIds?: unknown }).itemIds;
  if (!Array.isArray(raw)) return [];

  const ids: bigint[] = [];
  for (const value of raw) {
    try {
      const parsed = BigInt(String(value));
      if (parsed > BigInt(0)) ids.push(parsed);
    } catch {
      continue;
    }
  }
  return ids;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const session = await requireCartSession(request);
  if (session instanceof NextResponse) return session;

  const rateCheck = checkCartRateLimit("cart-add", BigInt(session.userId));
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { success: false, error: "Rate limit exceeded.", code: "CART_24400" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
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

  try {
    const productIdValue = (body as { productId?: unknown; product_id?: unknown }).productId ?? (body as { productId?: unknown; product_id?: unknown }).product_id;
    const quantityValue = Number((body as { quantity?: unknown }).quantity ?? 1);
    const variantValue = (body as { variant?: unknown }).variant;
    const subscriptionTierValue = (body as { subscriptionTier?: unknown; subscription_tier?: unknown }).subscriptionTier ?? (body as { subscriptionTier?: unknown; subscription_tier?: unknown }).subscription_tier;
    const logoTypeValue = (body as { logoType?: unknown; logo_type?: unknown }).logoType ?? (body as { logoType?: unknown; logo_type?: unknown }).logo_type;
    const customDataValue = (body as { customData?: unknown; custom_data?: unknown }).customData ?? (body as { customData?: unknown; custom_data?: unknown }).custom_data;

    const productId = BigInt(String(productIdValue));
    const result = await addMerchandiseToCart(BigInt(session.userId), {
      productId,
      quantity: quantityValue,
      variant: typeof variantValue === "string" ? variantValue : null,
      subscriptionTier: typeof subscriptionTierValue === "string" ? subscriptionTierValue : null,
      logoType: typeof logoTypeValue === "string" ? logoTypeValue : null,
      customData: customDataValue === undefined ? undefined : (customDataValue as never),
    });

    return NextResponse.json(
      {
        success: true,
        data: result,
        meta: { requestId: randomUUID(), responseTime: Date.now() - startedAt },
      },
      { status: result.created ? 201 : 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error && error.message === "CART_24100" ? "Product not found." : "Unable to add item.",
        code: error instanceof Error ? error.message : undefined,
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const startedAt = Date.now();
  const session = await requireCartSession(request);
  if (session instanceof NextResponse) return session;

  const rateCheck = checkCartRateLimit("cart-batch-remove", BigInt(session.userId));
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { success: false, error: "Rate limit exceeded.", code: "CART_24400" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const itemIds = parseItemIds(body);
  const summary = await batchRemoveCartItems(BigInt(session.userId), itemIds);

  return NextResponse.json({
    success: true,
    message: "Items removed",
    data: { cartSummary: summary },
    meta: { requestId: randomUUID(), responseTime: Date.now() - startedAt },
  });
}
