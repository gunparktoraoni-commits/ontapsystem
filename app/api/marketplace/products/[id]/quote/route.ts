// GET /api/marketplace/products/[id]/quote
// Public endpoint — returns authoritative unit price for merchandise options.
import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  calculateProductUnitPrice,
  ProductConfigErrorCode,
} from "@/lib/pricing/product-pricing.service";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("marketplace-product-quote", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } },
    );
  }

  try {
    const { id: rawId } = await params;
    let productId: bigint;
    try {
      productId = BigInt(rawId);
    } catch {
      return NextResponse.json({ success: false, error: "Invalid product ID." }, { status: 400 });
    }

    const q = request.nextUrl.searchParams;
    const subscriptionTier = q.get("subscriptionTier") ?? q.get("subscription_tier") ?? "basic";
    const logoType = q.get("logoType") ?? q.get("logo_type") ?? "default";
    const variant = q.get("variant");

    const quote = await calculateProductUnitPrice(productId, {
      subscriptionTier,
      logoType,
      variant,
    });

    return NextResponse.json(
      serialize({
        success: true,
        data: quote,
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message === ProductConfigErrorCode.PRODUCT_NOT_FOUND) {
      return NextResponse.json(
        { success: false, error: "Product not found.", code: ProductConfigErrorCode.PRODUCT_NOT_FOUND },
        { status: 404 },
      );
    }

    console.error("[marketplace/products/[id]/quote GET]", error);
    return NextResponse.json({ success: false, error: "An unexpected error occurred." }, { status: 500 });
  }
}
