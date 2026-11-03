import { NextRequest, NextResponse } from "next/server";
import { withOrderSuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  OrderManagementService,
  type ManagedOrderStatus,
  normalizeManagedOrderStatus,
} from "@/lib/services/order-management.service";
import { subscribeOrderStream } from "@/lib/orders/order-stream";
import { checkOrderRateLimit } from "@/lib/rate-limit/order-limits";
import {
  OrderErrorCode,
  createOrderError,
  toOrderErrorResponse,
} from "@/lib/errors/order-errors";
import { toOrderErrorNextResponse } from "@/lib/errors/order-http";

export const runtime = "nodejs";

function parseStatus(value: string | null, requestId: string): ManagedOrderStatus | "all" | undefined {
  if (!value) return undefined;

  const normalizedInput = value.trim().toLowerCase();
  if (normalizedInput === "all") return "all";

  const normalized = normalizeManagedOrderStatus(normalizedInput);
  if (!normalized) {
    throw createOrderError(
      OrderErrorCode.INVALID_FILTER,
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
    const rateLimit = checkOrderRateLimit(req, "STREAM", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toOrderErrorResponse(
          OrderErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many order stream requests. Please try again later.",
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

    const statusFilter = parseStatus(req.nextUrl.searchParams.get("status"), requestId);
    const orderIdFilter = req.nextUrl.searchParams.get("order_id")?.trim() || undefined;
    const orderNumberFilter = req.nextUrl.searchParams.get("order_number")?.trim() || undefined;

    const service = new OrderManagementService(requestId);
    const snapshot = await service.getStreamSnapshot(statusFilter);

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const write = (event: string, payload: unknown) => {
          const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
          controller.enqueue(encoder.encode(data));
        };

        write("snapshot", {
          ...snapshot,
          status_filter: statusFilter ?? "all",
          order_id_filter: orderIdFilter ?? null,
          order_number_filter: orderNumberFilter ?? null,
        });

        const unsubscribe = subscribeOrderStream(
          (payload) => {
            const event = payload as {
              orderId?: string;
              orderNumber?: string;
              status?: string;
            };

            if (statusFilter && statusFilter !== "all" && event.status !== statusFilter) return;
            if (orderIdFilter && event.orderId !== orderIdFilter) return;
            if (
              orderNumberFilter &&
              event.orderNumber?.toLowerCase() !== orderNumberFilter.toLowerCase()
            ) {
              return;
            }

            write("order-status", payload);
          },
          {
            orderId: orderIdFilter,
            orderNumber: orderNumberFilter,
          }
        );

        const heartbeat = setInterval(() => {
          write("ping", { time: Date.now() });
        }, 30_000);

        req.signal.addEventListener("abort", () => {
          clearInterval(heartbeat);
          unsubscribe();
          try {
            controller.close();
          } catch {
            // Ignore close errors when stream already ended.
          }
        });
      },
    });

    return new NextResponse(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    return toOrderErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to subscribe to order stream"
    );
  }
});

export async function GET(
  req: NextRequest,
  context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }
): Promise<Response> {
  return getHandler(req, context);
}
