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
    const rateLimit = checkOrderRateLimit(req, "PDF_REPORT", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toOrderMgmtErrorResponse(
          OrderMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many order PDF report requests. Please try again later.",
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
    const reportBuffer = await service.generatePdfReport({
      search: params.get("search")?.trim() || undefined,
      status: parseStatus(params.get("status"), requestId),
      payment_method: params.get("payment_method")?.trim() || undefined,
      start_date: params.get("start_date") ?? undefined,
      end_date: params.get("end_date") ?? undefined,
    });

    const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const fileName = `orders_report_${dateStamp}.pdf`;

    return new NextResponse(new Uint8Array(reportBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(reportBuffer.byteLength),
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    return toOrderMgmtErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to generate order PDF report"
    );
  }
});

export async function GET(
  req: NextRequest,
  context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }
): Promise<Response> {
  return getHandler(req, context);
}
