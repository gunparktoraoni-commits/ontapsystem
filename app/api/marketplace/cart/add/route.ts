// POST /api/marketplace/cart/add
// Auth required — adds an item to the cart. Resolves price server-side.
// Upserts if item already in cart (increments quantity).
// Rate limit: 60/min per IP.
import { NextRequest, NextResponse } from "next/server";
import type { InputJsonValue } from "@prisma/client/runtime/library";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { validateCsrfToken } from "@/lib/csrf";
import { addMerchandiseToCart } from "@/lib/services/cart.service";
import { ProductConfigErrorCode, normalizeProductOptions } from "@/lib/pricing/product-pricing.service";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

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

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("marketplace-cart-add", ip);
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
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ success: false, error: "Invalid request payload." }, { status: 400 });
    }

    const userId = BigInt(session.userId);
    const itemTypeRaw =
      (body as { itemType?: unknown; item_type?: unknown }).itemType ??
      (body as { itemType?: unknown; item_type?: unknown }).item_type ??
      "merchandise";
    const itemType = typeof itemTypeRaw === "string" ? itemTypeRaw.trim().toLowerCase() : "merchandise";

    if (itemType === "template") {
      const templateIdValue =
        (body as { itemId?: unknown; item_id?: unknown }).itemId ??
        (body as { itemId?: unknown; item_id?: unknown }).item_id ??
        (body as { productId?: unknown; product_id?: unknown }).productId ??
        (body as { productId?: unknown; product_id?: unknown }).product_id;
      const quantityValue = Number((body as { quantity?: unknown }).quantity ?? 1);

      if (templateIdValue === undefined || templateIdValue === null) {
        return NextResponse.json({ success: false, error: "Missing template id." }, { status: 400 });
      }
      if (!Number.isInteger(quantityValue) || quantityValue < 1 || quantityValue > 10000) {
        return NextResponse.json({ success: false, error: "Quantity must be a positive integer." }, { status: 400 });
      }

      let templateId: bigint;
      try {
        templateId = BigInt(String(templateIdValue));
      } catch {
        return NextResponse.json({ success: false, error: "Invalid template id." }, { status: 400 });
      }

      const template = await prisma.theme.findFirst({
        where: { id: templateId, is_active: true },
        select: { id: true, theme_name: true, price: true },
      });
      if (!template) {
        return NextResponse.json({ success: false, error: "Template not found or unavailable." }, { status: 404 });
      }

      const unitPrice = Number(template.price ?? 0);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return NextResponse.json({ success: false, error: "Template price is invalid." }, { status: 400 });
      }

      const existing = await prisma.cartItem.findFirst({
        where: {
          user_id: userId,
          item_type: "template",
          item_id: templateId,
          variant: null,
          subscription_tier: null,
          logo_type: null,
        },
      });

      if (!existing) {
        const currentCartCount = await prisma.cartItem.count({ where: { user_id: userId } });
        if (currentCartCount >= 50) {
          return NextResponse.json(
            { success: false, error: "Cart is full. Maximum 50 items allowed." },
            { status: 400 }
          );
        }
      }

      const cartItem = existing
        ? await prisma.cartItem.update({
            where: { id: existing.id },
            data: {
              quantity: existing.quantity + quantityValue,
              price_at_time: new Prisma.Decimal(unitPrice),
            },
          })
        : await prisma.cartItem.create({
            data: {
              user_id: userId,
              item_type: "template",
              item_id: templateId,
              quantity: quantityValue,
              price_at_time: new Prisma.Decimal(unitPrice),
            },
          });

      const allItems = await prisma.cartItem.findMany({
        where: { user_id: userId },
        select: { quantity: true, price_at_time: true },
      });
      const subtotal = allItems.reduce(
        (sum, item) => sum + Number(item.price_at_time) * item.quantity,
        0
      );

      return NextResponse.json(serialize({
        success: true,
        data: {
          cartItem: {
            id: cartItem.id,
            itemType: "template",
            itemId: templateId,
            name: template.theme_name,
            quantity: cartItem.quantity,
            unitPrice,
            lineTotal: unitPrice * cartItem.quantity,
          },
          cartSummary: {
            itemCount: allItems.length,
            subtotal: Math.round(subtotal * 100) / 100,
          },
        },
        message: existing ? "Cart item quantity updated." : "Item added to cart.",
      }), { status: existing ? 200 : 201 });
    }

    const productIdValue =
      (body as { productId?: unknown; product_id?: unknown }).productId ??
      (body as { productId?: unknown; product_id?: unknown }).product_id ??
      (body as { itemId?: unknown; item_id?: unknown }).itemId ??
      (body as { itemId?: unknown; item_id?: unknown }).item_id;
    const quantityValue = Number((body as { quantity?: unknown }).quantity ?? 1);
    const customDataValue =
      (body as { customData?: unknown; custom_data?: unknown }).customData ??
      (body as { customData?: unknown; custom_data?: unknown }).custom_data;
    const customDataObject =
      customDataValue && typeof customDataValue === "object" && !Array.isArray(customDataValue)
        ? (customDataValue as Record<string, unknown>)
        : null;
    const noteValue =
      (body as { note?: unknown }).note ?? customDataObject?.note ?? null;
    const variantValue =
      (body as { variant?: unknown }).variant ??
      customDataObject?.variant ??
      customDataObject?.varOption;
    const subscriptionTierValue =
      (body as { subscriptionTier?: unknown; subscription_tier?: unknown }).subscriptionTier ??
      (body as { subscriptionTier?: unknown; subscription_tier?: unknown }).subscription_tier ??
      customDataObject?.subscriptionTier ??
      customDataObject?.subsOption;
    const logoTypeValue =
      (body as { logoType?: unknown; logo_type?: unknown }).logoType ??
      (body as { logoType?: unknown; logo_type?: unknown }).logo_type ??
      customDataObject?.logoType ??
      customDataObject?.logoOption;

    if (productIdValue === undefined || productIdValue === null) {
      return NextResponse.json(
        { success: false, error: "Missing product configuration.", code: ProductConfigErrorCode.MISSING_CONFIGURATION },
        { status: 400 },
      );
    }

    if (!Number.isInteger(quantityValue) || quantityValue < 1 || quantityValue > 10000) {
      return NextResponse.json({ success: false, error: "Quantity must be a positive integer." }, { status: 400 });
    }

    if (typeof logoTypeValue !== "string" || !logoTypeValue.trim()) {
      return NextResponse.json(
        { success: false, error: "Missing product configuration.", code: ProductConfigErrorCode.MISSING_CONFIGURATION },
        { status: 400 },
      );
    }

    const productId = BigInt(String(productIdValue));
    const productRecord = await prisma.merchandise.findUnique({
      where: { id: productId },
      select: { name: true },
    });

    if (!productRecord) {
      return NextResponse.json(
        { success: false, error: "Product not found or unavailable.", code: ProductConfigErrorCode.PRODUCT_NOT_FOUND },
        { status: 404 },
      );
    }

    const productName = productRecord.name?.trim().toLowerCase() ?? "";
    const isPolyvinyl = productName === "polyvinyl business card";
    const isAutoPremiumProduct =
      productName === "bamboo digital business card" ||
      productName === "carbon fiber digital business card";

    const finalVariant = isPolyvinyl
      ? typeof variantValue === "string" && variantValue.trim()
        ? variantValue
        : null
      : null;

    const finalSubscriptionTier = isAutoPremiumProduct
      ? "premium"
      : typeof subscriptionTierValue === "string" && subscriptionTierValue.trim()
      ? subscriptionTierValue
      : null;

    if (!finalSubscriptionTier || !["basic", "standard", "premium"].includes(finalSubscriptionTier)) {
      return NextResponse.json(
        { success: false, error: "Missing product configuration.", code: ProductConfigErrorCode.MISSING_CONFIGURATION },
        { status: 400 },
      );
    }

    const sanitizedCustomData = customDataValue === undefined
      ? undefined
      : (customDataValue as Record<string, unknown> | null);
    if (sanitizedCustomData && !isPolyvinyl) {
      delete sanitizedCustomData.variant;
      delete sanitizedCustomData.varOption;
    }

    if (!finalSubscriptionTier) {
      return NextResponse.json(
        { success: false, error: "Missing product configuration.", code: ProductConfigErrorCode.MISSING_CONFIGURATION },
        { status: 400 },
      );
    }

    const normalizedOptions = normalizeProductOptions({
      variant: finalVariant,
      subscriptionTier: finalSubscriptionTier,
      logoType: logoTypeValue,
    });

    if (!['default', 'custom'].includes(normalizedOptions.logoType)) {
      return NextResponse.json(
        { success: false, error: "Invalid logo type.", code: ProductConfigErrorCode.INVALID_LOGO_TYPE },
        { status: 400 },
      );
    }

    const existing = await prisma.cartItem.findFirst({
      where: {
        user_id: userId,
        item_type: "merchandise",
        item_id: productId,
        variant: normalizedOptions.variant,
        subscription_tier: normalizedOptions.subscriptionTier,
        logo_type: normalizedOptions.logoType,
      },
    });

    if (!existing) {
      const currentCartCount = await prisma.cartItem.count({ where: { user_id: userId } });
      if (currentCartCount >= 50) {
        return NextResponse.json(
          { success: false, error: "Cart is full. Maximum 50 items allowed." },
          { status: 400 }
        );
      }
    }

    const result = await addMerchandiseToCart(userId, {
      productId,
      quantity: quantityValue,
      variant: normalizedOptions.variant,
      subscriptionTier: normalizedOptions.subscriptionTier,
      logoType: normalizedOptions.logoType,
      customData: sanitizedCustomData === undefined ? undefined : (sanitizedCustomData as unknown as InputJsonValue),
      note: typeof noteValue === 'string' ? noteValue : null,
    });

    return NextResponse.json(serialize({
      success: true,
      data: {
        cartItem: {
          id: result.cartItem.id,
          itemType: "merchandise",
          itemId: result.cartItem.productId,
          name: result.cartItem.name,
          quantity: result.cartItem.quantity,
          unitPrice: result.cartItem.price,
          lineTotal: result.cartItem.price * result.cartItem.quantity,
          variant: result.cartItem.variant,
          subscriptionTier: result.cartItem.subscriptionTier,
          logoType: result.cartItem.logoType,
          customData: result.cartItem.customData,
        },
        cartSummary: result.cartSummary,
      },
      message: result.created ? "Item added to cart." : "Cart item quantity updated.",
    }), { status: result.created ? 201 : 200 });
  } catch (err) {
    console.error("[marketplace/cart/add POST]", err);
    if (err instanceof Error && err.message === ProductConfigErrorCode.PRODUCT_NOT_FOUND) {
      return NextResponse.json(
        { success: false, error: "Product not found or unavailable.", code: ProductConfigErrorCode.PRODUCT_NOT_FOUND },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: false, error: "An unexpected error occurred." }, { status: 500 });
  }
}
