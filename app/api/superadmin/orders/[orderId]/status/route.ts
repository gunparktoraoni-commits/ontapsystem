import { NextRequest, NextResponse } from "next/server";
import { getClientIp, getUserAgent } from "@/server/lib/auth";
import { withOrderSuperAdmin, type SuperAdminContext } from "@/lib/auth/superadmin-middleware";
import {
  OrderManagementService,
  type ManagedOrderStatus,
  type OrderStatusUpdateInput,
  normalizeManagedOrderStatus,
} from "@/lib/services/order-management.service";
import { checkOrderRateLimit } from "@/lib/rate-limit/order-limits";
import {
  OrderMgmtErrorCode,
  createOrderMgmtError,
  toOrderMgmtErrorResponse,
} from "@/lib/errors/order-mgmt-errors";
import { toOrderMgmtErrorNextResponse } from "@/lib/errors/order-mgmt-http";

type RouteContext = SuperAdminContext & {
  params: Promise<{ orderId: string }>;
};

type RouteParams = {
  params: Promise<{ orderId: string }>;
};

function parseOrderId(raw: string, requestId: string): string {
  const normalized = raw.trim();
  if (!normalized) {
    throw createOrderMgmtError(
      OrderMgmtErrorCode.INVALID_ORDER_ID,
      "Invalid orderId path parameter",
      400,
      requestId,
      { orderId: raw }
    );
  }
  return normalized;
}

function parseBody(body: unknown, requestId: string): OrderStatusUpdateInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createOrderMgmtError(
      OrderMgmtErrorCode.INVALID_REQUEST_BODY,
      "Request body must be an object",
      400,
      requestId
    );
  }

  const payload = body as Record<string, unknown>;
  if (typeof payload.status !== "string" || !payload.status.trim()) {
    throw createOrderMgmtError(
      OrderMgmtErrorCode.INVALID_STATUS,
      "status is required",
      400,
      requestId
    );
  }

  const normalizedStatus = normalizeManagedOrderStatus(payload.status);
  if (!normalizedStatus) {
    throw createOrderMgmtError(
      OrderMgmtErrorCode.INVALID_STATUS,
      "Invalid status",
      400,
      requestId,
      { status: payload.status }
    );
  }

  return {
    status: normalizedStatus as ManagedOrderStatus,
    reason: typeof payload.reason === "string" ? payload.reason : undefined,
    tracking_number: typeof payload.tracking_number === "string" ? payload.tracking_number : undefined,
    tracking_carrier: typeof payload.tracking_carrier === "string" ? payload.tracking_carrier : undefined,
    tracking_url: typeof payload.tracking_url === "string" ? payload.tracking_url : undefined,
  };
}

const putHandler = withOrderSuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkOrderRateLimit(req, "UPDATE_STATUS", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toOrderMgmtErrorResponse(
          OrderMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many order status update requests. Please try again later.",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfter ?? 1),
          },
        }
      );
    }

    const body = await req.json().catch(() => null);
    const input = parseBody(body, requestId);

    const { orderId } = await context.params;
    const parsedOrderId = parseOrderId(orderId, requestId);

    const service = new OrderManagementService(requestId);
    const result = await service.updateOrderStatus(
      parsedOrderId,
      input,
      String(user.id),
      {
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      }
    );

    return NextResponse.json({
      success: true,
      data: result,
      message: "Order status updated successfully",
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return toOrderMgmtErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to update order status"
    );
  }
});

export async function PUT(req: NextRequest, context: RouteParams): Promise<Response> {
  return putHandler(req, context);
}
