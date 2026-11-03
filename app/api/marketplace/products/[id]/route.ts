// GET /api/marketplace/products/[id]
// Public endpoint — returns single merchandise item with related products.
// Rate limit: 120/min per IP.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { resolveMerchandiseBasePrice } from "@/lib/pricing/product-pricing.service";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("marketplace-product-detail", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
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

    const product = await prisma.merchandise.findFirst({
      where: { id: productId, is_active: true },
    });

    if (!product) {
      return NextResponse.json({ success: false, error: "Product not found." }, { status: 404 });
    }

    // Fetch related products from same category (max 4, excluding self)
    const related = await prisma.merchandise.findMany({
      where: {
        category: product.category,
        is_active: true,
        NOT: { id: productId },
      },
      take: 4,
      orderBy: { created_at: "desc" },
    });

    return NextResponse.json(serialize({
      success: true,
      data: {
        product: {
          id: product.id.toString(),
          name: product.name,
          description: product.description,
          price: resolveMerchandiseBasePrice(product),
          listPrice: Number(product.price),
          customPrice: product.custom_price,
          customPriceValue:
            product.custom_price_value !== null
              ? Number(product.custom_price_value)
              : null,
          imgUrl: product.img_url,
          category: product.category,
          metadata: product.metadata,
          createdAt: product.created_at,
          updatedAt: product.updated_at,
        },
        related: related.map((r) => ({
          id: r.id.toString(),
          name: r.name,
          price: resolveMerchandiseBasePrice(r),
          listPrice: Number(r.price),
          imgUrl: r.img_url,
          category: r.category,
          inStock: r.is_active,
        })),
      },
    }));
  } catch (err) {
    console.error("[marketplace/products/[id] GET]", err);
    return NextResponse.json({ success: false, error: "An unexpected error occurred." }, { status: 500 });
  }
}
