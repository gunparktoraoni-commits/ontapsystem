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

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

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
    const rateLimit = checkOrderRateLimit(req, "RECENT", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toOrderMgmtErrorResponse(
          OrderMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many recent order requests. Please try again later.",
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

    const params = req.nextUrl.searchParams;
    const service = new OrderManagementService(requestId);

    const result = await service.getRecentOrders({
      page: parsePositiveInt(params.get("page"), 1, 1, 100000),
      limit: parsePositiveInt(params.get("limit"), 15, 1, 100),
      days: parsePositiveInt(params.get("days"), 14, 1, 90),
      search: params.get("search")?.trim() || undefined,
      status: parseStatus(params.get("status"), requestId),
      payment_method: params.get("payment_method")?.trim() || undefined,
    });

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
    return toOrderMgmtErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to fetch recent orders"
    );
  }
});

export async function GET(
  req: NextRequest,
  context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }
): Promise<Response> {
  return getHandler(req, context);
}
