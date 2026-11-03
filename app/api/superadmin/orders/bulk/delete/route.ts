import { NextRequest, NextResponse } from "next/server";
import { withOrderSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { OrderManagementService } from "@/lib/services/order-management.service";
import { checkOrderRateLimit } from "@/lib/rate-limit/order-limits";
import {
  OrderErrorCode,
  createOrderError,
  toOrderErrorResponse,
} from "@/lib/errors/order-errors";
import { toOrderErrorNextResponse } from "@/lib/errors/order-http";

function parseBody(body: unknown, requestId: string): { order_ids: string[] } {
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
    .map((value) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : ""))
    .filter(Boolean);

  if (orderIds.length === 0) {
    throw createOrderError(
      OrderErrorCode.INVALID_REQUEST_BODY,
      "order_ids must contain at least one order identifier",
      400,
      requestId
    );
  }

  return { order_ids: orderIds };
}

const postHandler = withOrderSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkOrderRateLimit(req, "BULK_DELETE", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toOrderErrorResponse(
          OrderErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many bulk delete requests. Please try again later.",
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
    const result = await service.deleteOrders(parsed.order_ids, String(user.id));

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
      "Failed to permanently delete orders"
    );
  }
});

export async function POST(
  req: NextRequest,
  context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }
): Promise<Response> {
  return postHandler(req, context);
}

export async function DELETE(
  req: NextRequest,
  context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }
): Promise<Response> {
  return postHandler(req, context);
}
