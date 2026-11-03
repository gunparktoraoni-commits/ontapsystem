import { NextRequest, NextResponse } from "next/server";
import { withOrderSuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  OrderManagementService,
  type ManagedOrderStatus,
  normalizeManagedOrderStatus,
} from "@/lib/services/order-management.service";
import { checkOrderRateLimit } from "@/lib/rate-limit/order-limits";
import {
  OrderMgmtErrorCode,
  createOrderMgmtError,
  toOrderMgmtErrorResponse,
} from "@/lib/errors/order-mgmt-errors";
import { toOrderMgmtErrorNextResponse } from "@/lib/errors/order-mgmt-http";

function parseStatus(value: string | null, requestId: string): ManagedOrderStatus | "all" | undefined {
  if (!value) return undefined;

  const normalizedInput = value.trim().toLowerCase();
  if (normalizedInput === "all") return "all";

  const normalized = normalizeManagedOrderStatus(normalizedInput);
  if (!normalized) {
    throw createOrderMgmtError(
      OrderMgmtErrorCode.INVALID_FILTER,
      "Invalid status filter",
      400,
      requestId,
      { status: value }
    );
  }

  return normalized;
}

const getHandler = withOrderSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkOrderRateLimit(req, "ANALYTICS", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toOrderMgmtErrorResponse(
          OrderMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many order analytics requests. Please try again later.",
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

    const service = new OrderManagementService(requestId);
    const data = await service.getOrderAnalytics({
      start_date: req.nextUrl.searchParams.get("start_date") ?? undefined,
      end_date: req.nextUrl.searchParams.get("end_date") ?? undefined,
      status: parseStatus(req.nextUrl.searchParams.get("status"), requestId),
    });

    return NextResponse.json({
      success: true,
      data,
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
      "Failed to fetch order analytics"
    );
  }
});

export async function GET(
  req: NextRequest,
  context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }
): Promise<Response> {
  return getHandler(req, context);
}
