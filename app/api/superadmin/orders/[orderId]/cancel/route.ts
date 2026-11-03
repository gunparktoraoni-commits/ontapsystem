import { NextRequest, NextResponse } from "next/server";
import { getClientIp, getUserAgent } from "@/server/lib/auth";
import { withOrderSuperAdmin, type SuperAdminContext } from "@/lib/auth/superadmin-middleware";
import { OrderManagementService } from "@/lib/services/order-management.service";
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

function parseReason(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }

  const payload = body as Record<string, unknown>;
  return typeof payload.reason === "string" ? payload.reason : undefined;
}

const postHandler = withOrderSuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkOrderRateLimit(req, "CANCEL", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toOrderMgmtErrorResponse(
          OrderMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many order cancellation requests. Please try again later.",
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
    const body = await req.json().catch(() => null);

    const service = new OrderManagementService(requestId);
    const result = await service.cancelOrder(
      parsedOrderId,
      String(user.id),
      parseReason(body),
      {
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      }
    );

    return NextResponse.json({
      success: true,
      data: result,
      message: "Order cancelled successfully",
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
      "Failed to cancel order"
    );
  }
});

export async function POST(req: NextRequest, context: RouteParams): Promise<Response> {
  return postHandler(req, context);
}
