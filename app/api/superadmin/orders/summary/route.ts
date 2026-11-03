import { NextRequest, NextResponse } from "next/server";
import { withOrderSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { OrderManagementService } from "@/lib/services/order-management.service";
import { checkOrderRateLimit } from "@/lib/rate-limit/order-limits";
import { OrderErrorCode, toOrderErrorResponse } from "@/lib/errors/order-errors";
import { toOrderErrorNextResponse } from "@/lib/errors/order-http";

const getHandler = withOrderSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkOrderRateLimit(req, "SUMMARY", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toOrderErrorResponse(
          OrderErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many order summary requests. Please try again later.",
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
    const summary = await service.getOrderSummary({
      start_date: req.nextUrl.searchParams.get("start_date") ?? undefined,
      end_date: req.nextUrl.searchParams.get("end_date") ?? undefined,
    });

    return NextResponse.json({
      success: true,
      data: summary,
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
      "Failed to fetch order summary"
    );
  }
});

export async function GET(
  req: NextRequest,
  context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }
): Promise<Response> {
  return getHandler(req, context);
}
