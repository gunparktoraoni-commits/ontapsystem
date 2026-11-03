// GET /api/marketplace/cart
// Auth required — returns cart items with resolved product/template details.
// Optional: ?countOnly=1 — lightweight badge count for headers (avoids full price resolution).
// Rate limit: 60/min per IP.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { calculateProductUnitPrice } from "@/lib/pricing/product-pricing.service";
import { parseJsonObject } from "@/server/lib/json-field";

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

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return "An unexpected error occurred.";
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("marketplace-cart-view", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const { session } = auth;

  try {
    const userId = BigInt(session.userId);
    const countOnly = request.nextUrl.searchParams.get("countOnly") === "1";

    if (countOnly) {
      const itemCount = await prisma.cartItem.count({ where: { user_id: userId } });
      return NextResponse.json({
        success: true,
        data: { itemCount },
      });
    }

    const cartItems = await prisma.cartItem.findMany({
      where: { user_id: userId },
      orderBy: { added_at: "desc" },
    });

    if (cartItems.length === 0) {
      return NextResponse.json(serialize({
        success: true,
        data: { items: [], subtotal: 0, itemCount: 0 },
      }));
    }

    // Separate by type so we can batch-fetch details
    const merchandiseIds = cartItems
      .filter((c) => c.item_type === "merchandise")
      .map((c) => c.item_id);
    const templateIds = cartItems
      .filter((c) => c.item_type === "template")
      .map((c) => c.item_id);
    const planIds = cartItems
      .filter((c) => c.item_type === "subscription_plan")
      .map((c) => c.item_id);

    const [merchandise, templates, plans] = await Promise.all([
      merchandiseIds.length > 0
        ? prisma.merchandise.findMany({ where: { id: { in: merchandiseIds } } })
        : Promise.resolve([]),
      templateIds.length > 0
        ? prisma.theme.findMany({
            where: { id: { in: templateIds } },
            select: { id: true, theme_name: true, price: true, preview_images: true, tag: true, category: true },
          })
        : Promise.resolve([]),
      planIds.length > 0
        ? prisma.subscriptionPlan.findMany({ where: { id: { in: planIds } } })
        : Promise.resolve([]),
    ]);

    const merchandiseMap = new Map(merchandise.map((m) => [m.id.toString(), m]));
    const templateMap = new Map(templates.map((t) => [t.id.toString(), t]));
    const planMap = new Map(plans.map((p) => [p.id.toString(), p]));

    let subtotal = 0;
    const priceUpdates: Array<{ id: bigint; price: number }> = [];

    const resolvedItems = await Promise.all(cartItems.map(async (item) => {
      try {
        const itemIdStr = item.item_id.toString();
        let details: Record<string, unknown> | null = null;
        let unitPrice = Number(item.price_at_time);
        if (!Number.isFinite(unitPrice)) unitPrice = 0;
        let name = "Unknown item";
        let available = false;

        if (item.item_type === "merchandise") {
          const m = merchandiseMap.get(itemIdStr);
          if (m) {
            name = m.name;
            available = m.is_active;
            try {
              const recalc = await calculateProductUnitPrice(item.item_id, {
                variant: item.variant,
                subscriptionTier: item.subscription_tier,
                logoType: item.logo_type,
              });
              if (Number.isFinite(recalc.unitPrice)) {
                unitPrice = recalc.unitPrice;
                if (Math.abs(Number(item.price_at_time) - unitPrice) > 0.01) {
                  priceUpdates.push({ id: item.id, price: unitPrice });
                }
              }
            } catch {
              unitPrice = Number(item.price_at_time);
              if (!Number.isFinite(unitPrice)) unitPrice = 0;
            }

            const productName = m.name?.trim().toLowerCase() ?? "";
            const isPolyvinyl = productName === "polyvinyl business card";
            const isAutoPremiumProduct =
              productName === "bamboo digital business card" ||
              productName === "carbon fiber digital business card";

            const parsedCustomData = parseJsonObject(item.custom_data);
            const cartCustomData = parsedCustomData ? { ...parsedCustomData } : null;
            if (cartCustomData && !isPolyvinyl) {
              delete cartCustomData.variant;
              delete cartCustomData.varOption;
            }

            const defaultImage =
              m.img_url ??
              m.front_img ??
              m.back_img ??
              m.variable_front_img ??
              m.variable_back_img ??
              null;

            let imgUrl = defaultImage;
            if (isPolyvinyl) {
              imgUrl = item.variant === "dark"
                ? m.variable_front_img ?? m.variable_back_img ?? defaultImage
                : m.front_img ?? m.back_img ?? defaultImage;
            } else if (isAutoPremiumProduct) {
              imgUrl = m.front_img ?? m.back_img ?? defaultImage;
            } else {
              imgUrl = m.img_url ?? m.front_img ?? m.back_img ?? m.variable_front_img ?? m.variable_back_img ?? defaultImage;
            }

            details = {
              imgUrl,
              category: m.category,
              customData: cartCustomData,
            };
          }
        } else if (item.item_type === "template") {
          const t = templateMap.get(itemIdStr);
          if (t) {
            name = t.theme_name;
            unitPrice = Number(t.price);
            if (!Number.isFinite(unitPrice)) unitPrice = 0;
            available = true;
            details = {
              previewImages: t.preview_images,
              tag: t.tag,
              category: t.category,
            };
          }
        } else if (item.item_type === "subscription_plan") {
          const p = planMap.get(itemIdStr);
          if (p) {
            name = p.name;
            const billingCycle = (parseJsonObject(item.custom_data) as Record<string, string> | null)?.billing_cycle ?? "monthly";
            unitPrice = billingCycle === "yearly" ? Number(p.price_yearly ?? 0) : Number(p.price_monthly ?? 0);
            if (!Number.isFinite(unitPrice)) unitPrice = 0;
            available = p.is_active;
            details = { billingCycle };
          }
        }

        const lineTotal = unitPrice * item.quantity;
        subtotal += lineTotal;

        return {
          id: item.id.toString(),
          itemType: item.item_type,
          itemId: itemIdStr,
          name,
          quantity: item.quantity,
          unitPrice,
          lineTotal,
          customData: item.custom_data,
          details,
          available,
          addedAt: item.added_at,
        };
      } catch (itemErr) {
        console.error("[marketplace/cart GET] item resolve failed", {
          cartItemId: item.id.toString(),
          itemType: item.item_type,
          itemId: item.item_id.toString(),
          error: errorMessage(itemErr),
        });
        const fallbackPrice = Number(item.price_at_time);
        const unitPrice = Number.isFinite(fallbackPrice) ? fallbackPrice : 0;
        const lineTotal = unitPrice * item.quantity;
        subtotal += lineTotal;
        return {
          id: item.id.toString(),
          itemType: item.item_type,
          itemId: item.item_id.toString(),
          name: "Unavailable item",
          quantity: item.quantity,
          unitPrice,
          lineTotal,
          customData: item.custom_data,
          details: null,
          available: false,
          addedAt: item.added_at,
        };
      }
    }));

    if (priceUpdates.length > 0) {
      await Promise.all(
        priceUpdates.map(({ id, price }) =>
          prisma.cartItem.update({
            where: { id },
            data: { price_at_time: new Prisma.Decimal(price) },
          }),
        ),
      ).catch((updateErr) => {
        console.error("[marketplace/cart GET] price sync failed", errorMessage(updateErr));
      });
    }

    return NextResponse.json(serialize({
      success: true,
      data: {
        items: resolvedItems,
        subtotal: Math.round(subtotal * 100) / 100,
        itemCount: cartItems.length,
        hasUnavailableItems: resolvedItems.some((i) => !i.available),
      },
    }));
  } catch (err) {
    console.error("[marketplace/cart GET]", err);
    return NextResponse.json(
      {
        success: false,
        error: "An unexpected error occurred.",
        ...(process.env.NODE_ENV !== "production" ? { detail: errorMessage(err) } : {}),
      },
      { status: 500 },
    );
  }
}
