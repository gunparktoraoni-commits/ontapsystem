import { NextRequest, NextResponse } from "next/server";
import { withOrderSuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  OrderManagementService,
  type ManagedOrderStatus,
  type OrderSortBy,
  normalizeManagedOrderStatus,
} from "@/lib/services/order-management.service";
import { checkOrderRateLimit } from "@/lib/rate-limit/order-limits";
import {
  OrderErrorCode,
  createOrderError,
  toOrderErrorResponse,
} from "@/lib/errors/order-errors";
import { toOrderErrorNextResponse } from "@/lib/errors/order-http";

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseFilters(req: NextRequest, requestId: string) {
  const params = req.nextUrl.searchParams;
  const page = parsePositiveInt(params.get("page"), 1, 1, 100000);
  const limit = parsePositiveInt(params.get("limit"), 15, 1, 100);
  const search = params.get("search")?.trim() || undefined;

  const rawStatus = (params.get("status") ?? "all").trim().toLowerCase();
  if (rawStatus !== "all" && !normalizeManagedOrderStatus(rawStatus)) {
    throw createOrderError(
      OrderErrorCode.INVALID_FILTER,
      "Invalid status filter",
      400,
      requestId,
      { status: rawStatus }
    );
  }

  const status: ManagedOrderStatus | "all" =
    rawStatus === "all" ? "all" : normalizeManagedOrderStatus(rawStatus)!;

  const rawSortBy = (params.get("sort_by") ?? "placed_at").trim().toLowerCase();
  const allowedSortBy = new Set(["placed_at", "total_amount", "status_changed_at", "order_number"]);
  if (!allowedSortBy.has(rawSortBy)) {
    throw createOrderError(
      OrderErrorCode.INVALID_FILTER,
      "Invalid sort_by filter",
      400,
      requestId,
      { sort_by: rawSortBy }
    );
  }

  const rawSortDir = (params.get("sort_dir") ?? "desc").trim().toLowerCase();
  if (rawSortDir !== "asc" && rawSortDir !== "desc") {
    throw createOrderError(
      OrderErrorCode.INVALID_FILTER,
      "Invalid sort_dir filter",
      400,
      requestId,
      { sort_dir: rawSortDir }
    );
  }

  return {
    page,
    limit,
    search,
    status,
    payment_method: params.get("payment_method")?.trim() || undefined,
    sort_by: rawSortBy as OrderSortBy,
    sort_dir: rawSortDir as "asc" | "desc",
    start_date: params.get("start_date") ?? undefined,
    end_date: params.get("end_date") ?? undefined,
  };
}

const getHandler = withOrderSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkOrderRateLimit(req, "LIST", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toOrderErrorResponse(
          OrderErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many order list requests. Please try again later.",
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

    const filters = parseFilters(req, requestId);
    const service = new OrderManagementService(requestId);
    const result = await service.getOrders(filters);

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
      "Failed to fetch orders"
    );
  }
});

export async function GET(
  req: NextRequest,
  context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }
): Promise<Response> {
  return getHandler(req, context);
}
