import { NextRequest, NextResponse } from "next/server";
import {
  resolveRequestSession,
  resolveEffectiveUserId,
  getClientIp,
} from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getRequestId } from "@/lib/errors/http";
import { reconcileUserShopOrderByIdentifier } from "@/server/lib/marketplace/xendit-order-reconcile";
import { PAYMENT_CONFIRMED_STATUSES } from "@/server/lib/marketplace/order-fulfillment";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, value) => (typeof value === "bigint" ? value.toString() : value)));

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();

  try {
    const ip = getClientIp(request);
    const rateCheck = checkRateLimit("marketplace-order-status", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        },
      );
    }

    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      return NextResponse.json(
        { success: false, error: "Authentication required.", requiresAuth: true },
        { status: 401 },
      );
    }

    const { orderId } = await params;
    const trimmedOrderId = orderId?.trim();
    if (!trimmedOrderId) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid order ID.",
          code: "MARKETPLACE_ORDER_STATUS_INVALID",
          tag: "[MARKETPLACE_ORDER_STATUS]",
        },
        { status: 400 },
      );
    }

    const reconcileDisabled =
      request.nextUrl.searchParams.get("reconcile") === "0";

    const userId = BigInt(resolveEffectiveUserId(auth));

    let resolvedOrder;
    let reconcileResult: import("@/server/lib/marketplace/xendit-order-reconcile").ReconcileResult | null =
      null;

    if (reconcileDisabled) {
      const { findUserShopOrder } = await import(
        "@/server/lib/marketplace/shop-order-access"
      );
      resolvedOrder = await findUserShopOrder(userId, trimmedOrderId);
    } else {
      const result = await reconcileUserShopOrderByIdentifier(userId, trimmedOrderId);
      resolvedOrder = result.order;
      reconcileResult = result.reconcileResult;
    }

    if (!resolvedOrder) {
      return NextResponse.json(
        {
          success: false,
          error: "Order not found.",
          code: "MARKETPLACE_ORDER_NOT_FOUND",
          tag: "[MARKETPLACE_ORDER_STATUS]",
        },
        { status: 404 },
      );
    }

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          order_id: resolvedOrder.id.toString(),
          order_number: resolvedOrder.order_number,
          status: resolvedOrder.status,
          xendit_status: resolvedOrder.xendit_status,
          xendit_invoice_url: PAYMENT_CONFIRMED_STATUSES.has(resolvedOrder.status)
            ? null
            : resolvedOrder.xendit_invoice_url,
          items: resolvedOrder.items.map((item) => ({
            item_type: item.item_type,
            item_id: item.item_id.toString(),
            item_name: item.item_name,
            quantity: item.quantity,
            unit_price: Number(item.unit_price),
            total_price: Number(item.total_price),
          })),
          reconcile_result: reconcileResult,
        },
        meta: { requestId, responseTime: Date.now() - startedAt },
      }),
    );
  } catch (error) {
    console.error("[MARKETPLACE_ORDER_STATUS] Failed to load order status", {
      requestId,
      error,
    });
    return NextResponse.json(
      {
        success: false,
        error: "Failed to load order status.",
        code: "MARKETPLACE_ORDER_STATUS_FAILED",
        tag: "[MARKETPLACE_ORDER_STATUS]",
      },
      { status: 500 },
    );
  }
}
