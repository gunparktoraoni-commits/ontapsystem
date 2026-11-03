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
    const rateLimit = checkOrderRateLimit(req, "EXPORT", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toOrderMgmtErrorResponse(
          OrderMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many order export requests. Please try again later.",
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
    const format = (params.get("format") ?? "csv").trim().toLowerCase();

    if (format !== "csv" && format !== "xlsx") {
      throw createOrderMgmtError(
        OrderMgmtErrorCode.INVALID_FILTER,
        "Invalid format. Allowed: csv, xlsx",
        400,
        requestId,
        { format }
      );
    }

    const rawSortBy = (params.get("sort_by") ?? "placed_at").trim().toLowerCase();
    const allowedSortBy = new Set(["placed_at", "total_amount", "status_changed_at", "order_number"]);
    if (!allowedSortBy.has(rawSortBy)) {
      throw createOrderMgmtError(
        OrderMgmtErrorCode.INVALID_FILTER,
        "Invalid sort_by filter",
        400,
        requestId,
        { sort_by: rawSortBy }
      );
    }

    const rawSortDir = (params.get("sort_dir") ?? "desc").trim().toLowerCase();
    if (rawSortDir !== "asc" && rawSortDir !== "desc") {
      throw createOrderMgmtError(
        OrderMgmtErrorCode.INVALID_FILTER,
        "Invalid sort_dir filter",
        400,
        requestId,
        { sort_dir: rawSortDir }
      );
    }

    const service = new OrderManagementService(requestId);
    const fileBuffer = await service.exportOrders(
      {
        search: params.get("search")?.trim() || undefined,
        status: parseStatus(params.get("status"), requestId),
        payment_method: params.get("payment_method")?.trim() || undefined,
        sort_by: rawSortBy as OrderSortBy,
        sort_dir: rawSortDir as "asc" | "desc",
        start_date: params.get("start_date") ?? undefined,
        end_date: params.get("end_date") ?? undefined,
      },
      format as "csv" | "xlsx"
    );

    const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const fileName = `orders_export_${dateStamp}.${format}`;

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        "Content-Type":
          format === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(fileBuffer.byteLength),
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    return toOrderMgmtErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to export orders"
    );
  }
});

export async function GET(
  req: NextRequest,
  context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }
): Promise<Response> {
  return getHandler(req, context);
}
