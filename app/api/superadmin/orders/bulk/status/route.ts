import { NextRequest, NextResponse } from "next/server";
import { getClientIp, getUserAgent } from "@/server/lib/auth";
import { withOrderSuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  OrderManagementService,
  type ManagedOrderStatus,
  type OrderStatusUpdateInput,
} from "@/lib/services/order-management.service";
import { checkOrderRateLimit } from "@/lib/rate-limit/order-limits";
import {
  OrderErrorCode,
  createOrderError,
  toOrderErrorResponse,
} from "@/lib/errors/order-errors";
import { toOrderErrorNextResponse } from "@/lib/errors/order-http";

function parseBody(body: unknown, requestId: string): { order_ids: string[]; input: OrderStatusUpdateInput } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createOrderError(
      OrderErrorCode.INVALID_REQUEST_BODY,
      "Request body must be an object",
      400,
      requestId
    );
  }

  const payload = body as Record<string, unknown>;
  const rawOrderIds = Array.isArray(payload.order_ids) ? payload.order_ids : [];
  const orderIds = rawOrderIds
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  if (orderIds.length === 0) {
    throw createOrderError(
      OrderErrorCode.INVALID_REQUEST_BODY,
      "order_ids must contain at least one order identifier",
      400,
      requestId
    );
  }

  if (typeof payload.status !== "string" || !payload.status.trim()) {
    throw createOrderError(
      OrderErrorCode.INVALID_STATUS,
      "status is required",
      400,
      requestId
    );
  }

  return {
    order_ids: orderIds,
    input: {
      status: payload.status.trim().toLowerCase() as ManagedOrderStatus,
      reason: typeof payload.reason === "string" ? payload.reason : undefined,
      tracking_number: typeof payload.tracking_number === "string" ? payload.tracking_number : undefined,
      tracking_carrier: typeof payload.tracking_carrier === "string" ? payload.tracking_carrier : undefined,
      tracking_url: typeof payload.tracking_url === "string" ? payload.tracking_url : undefined,
    },
  };
}

const postHandler = withOrderSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkOrderRateLimit(req, "BULK_UPDATE", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toOrderErrorResponse(
          OrderErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many bulk update requests. Please try again later.",
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
    const parsed = parseBody(body, requestId);

    const service = new OrderManagementService(requestId);
    const result = await service.bulkUpdateOrderStatus(
      parsed.order_ids,
      parsed.input,
      String(user.id),
      {
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      }
    );

    return NextResponse.json({
      success: true,
      data: result,
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return toOrderErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to bulk update order statuses"
    );
  }
});

export async function POST(
  req: NextRequest,
  context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }
): Promise<Response> {
  return postHandler(req, context);
}
