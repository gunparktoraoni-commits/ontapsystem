// POST /api/superadmin/orders/[orderId]/complete
// Auth required (Admin/Staff) — marks order as completed and awards spins to user.
// Rate limit: 30/min per IP.

import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { prisma } from "@/server/lib/prisma";
import { RouletteService } from "@/lib/services/roulette.service";
import { generateRequestId } from "@/lib/utils/request-utils";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const requestId = generateRequestId();
  const ip = getClientIp(request);
  const { orderId: orderIdParam } = await params;

  // Rate limiting check
  const rateCheck = checkRateLimit("admin-order-complete", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RATE_LIMIT",
          message: "Too many requests. Please slow down.",
          retry_after: Math.ceil(rateCheck.retryAfterMs / 1000),
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  // Authentication check
  const resolved = await resolveRequestSession(request);
  if (!resolved.session) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Authentication required.", requiresAuth: true },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status: 401 }
    );
  }

  // Check admin/staff role
  const allowedRoles = ["super_admin", "admin", "staff"];
  if (!allowedRoles.includes(resolved.session.role?.toLowerCase() || "")) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "Admin or Staff access required." },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status: 403 }
    );
  }

  // Parse order ID
  const orderId = BigInt(orderIdParam);

  try {
    // Get order with items
    const order = await prisma.shopOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: `Order ${orderIdParam} not found.` },
          meta: { requestId, timestamp: new Date().toISOString() },
        },
        { status: 404 }
      );
    }

    // Check if already completed
    if (order.status === "completed") {
      return NextResponse.json(
        {
          success: false,
          error: { code: "ALREADY_COMPLETED", message: "Order is already completed." },
          meta: { requestId, timestamp: new Date().toISOString() },
        },
        { status: 400 }
      );
    }

    // Update order to completed status
    const updatedOrder = await prisma.shopOrder.update({
      where: { id: orderId },
      data: {
        status: "completed",
        completed_at: new Date(),
        status_changed_at: new Date(),
        status_changed_by: BigInt(resolved.session.userId),
      },
    });

    // Award spins based on item count
    const service = new RouletteService(requestId);
    const itemCount = order.items.length;

    let spinsAwarded = 0;
    let newBalance = 0;

    try {
      const awardResult = await service.awardSpinsForOrder(order.user_id, orderId, itemCount);
      spinsAwarded = awardResult.spinsAwarded;
      newBalance = awardResult.newBalance;
    } catch (spinError) {
      // Log error but don't fail the order completion
      console.error(`[Order Complete] Failed to award spins for order ${orderId}:`, spinError);
      // Continue - spins can be manually awarded later if needed
    }

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          order_id: orderId,
          status: updatedOrder.status,
          completed_at: updatedOrder.completed_at?.toISOString(),
          spins_awarded: spinsAwarded,
          new_spin_balance: newBalance,
          items_count: itemCount,
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      })
    );
  } catch (error) {
    console.error("[Order Complete] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to complete order",
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status: 500 }
    );
  }
}
