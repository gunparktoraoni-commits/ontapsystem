import { NextRequest, NextResponse } from "next/server";
import { withOrderSuperAdmin, type SuperAdminContext } from "@/lib/auth/superadmin-middleware";
import { OrderManagementService } from "@/lib/services/order-management.service";
import { checkOrderRateLimit } from "@/lib/rate-limit/order-limits";
import {
  OrderErrorCode,
  createOrderError,
  toOrderErrorResponse,
} from "@/lib/errors/order-errors";
import { toOrderErrorNextResponse } from "@/lib/errors/order-http";

type RouteContext = SuperAdminContext & {
  params: Promise<{ orderId: string }>;
};

type RouteParams = {
  params: Promise<{ orderId: string }>;
};

function parseOrderId(raw: string, requestId: string): string {
  const normalized = raw.trim();
  if (!normalized) {
    throw createOrderError(
      OrderErrorCode.INVALID_ORDER_ID,
      "Invalid orderId path parameter",
      400,
      requestId,
      { orderId: raw }
    );
  }
  return normalized;
}

const getHandler = withOrderSuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkOrderRateLimit(req, "TIMELINE", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toOrderErrorResponse(
          OrderErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many order timeline requests. Please try again later.",
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

    const { orderId } = await context.params;
    const parsedOrderId = parseOrderId(orderId, requestId);

    const service = new OrderManagementService(requestId);
    const timeline = await service.getOrderTimeline(parsedOrderId);

    return NextResponse.json({
      success: true,
      data: timeline,
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
      "Failed to fetch order timeline"
    );
  }
});

export async function GET(req: NextRequest, context: RouteParams): Promise<Response> {
  return getHandler(req, context);
}
