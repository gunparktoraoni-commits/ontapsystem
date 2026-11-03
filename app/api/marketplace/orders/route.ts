// app/api/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { Prisma } from "@prisma/client";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, value) => (typeof value === "bigint" ? value.toString() : value)));

async function requireSession(request: NextRequest) {
  const result = await resolveRequestSession(request);
  if (!result.session) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Authentication required.", requiresAuth: true }, { status: 401 }),
    };
  }
  return { ok: true as const, session: result.session };
}

// Helper to parse query parameters
function parseQueryParams(searchParams: URLSearchParams) {
  const status = searchParams.get("status") || undefined;
  const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);
  const page = Math.max(parseInt(searchParams.get("page") || "1"), 1);
  const skip = (page - 1) * limit;

  // Only allow specific status values
  const allowedStatuses = ["pending", "processing", "shipped", "delivered", "cancelled"];
  const normalizedStatus = status && allowedStatuses.includes(status) ? status : undefined;

  return { status: normalizedStatus, limit, page, skip };
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("marketplace-orders-list", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  try {
    const { status, limit, page, skip } = parseQueryParams(request.nextUrl.searchParams);
    const userId = BigInt(auth.session.userId);

    // Build filter
    const where: Prisma.ShopOrderWhereInput = {
      user_id: userId,
      ...(status ? { status } : {}),
    };

    // Get total count for pagination
    const total = await prisma.shopOrder.count({ where });

    // Fetch orders with minimal item info (just count and total amount)
    const orders = await prisma.shopOrder.findMany({
      where,
      orderBy: { placed_at: "desc" },
      skip,
      take: limit,
      include: {
        items: {
          select: {
            item_name: true,
            quantity: true,
            unit_price: true,
            total_price: true,
            item_type: true,
            item_id: true,
          },
        },
      },
    });

    // Transform to frontend-friendly format
    const transformedOrders = orders.map((order) => ({
      id: order.order_number, // use order_number as public ID
      orderNumber: order.order_number,
      date: order.placed_at,
      status: order.status,
      total: Number(order.total_amount),
      subtotal: Number(order.subtotal),
      discount: Number(order.discount_amount),
      deliveryFee: Number(order.shipping_amount),
      items: order.items.map((item) => ({
        id: Number(item.item_id),
        name: item.item_name,
        price: Number(item.unit_price),
        quantity: item.quantity,
        image: "", // will be filled by frontend based on item type
      })),
      trackingNumber: undefined, // not in current schema – can be added later
      estimatedDelivery: undefined,
    }));

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          orders: transformedOrders,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
          },
        },
      })
    );
  } catch (error) {
    console.error("[api/orders] Error:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch orders." }, { status: 500 });
  }
}