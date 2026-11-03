import { NextRequest, NextResponse } from "next/server";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { checkBizcardDashboardRateLimit } from "@/lib/rate-limit/bizcard-dashboard-limits";
import {
  BizcardDashboardErrorCode,
  createBizcardDashboardError,
  toBizcardDashboardErrorResponse,
} from "@/lib/errors/bizcard-dashboard-errors";
import { AppError } from "@/lib/errors/types";
import {
  BizcardDashboardService,
  parseBizcardIdentifier,
  serializeBizcardDashboardResponse,
  type DateFilterType,
} from "@/lib/services/bizcard-dashboard.service";

const ALLOWED_FILTERS = new Set<DateFilterType>(["today", "yesterday", "this_week", "this_month", "custom"]);

export async function GET(request: NextRequest) {
  const requestId = `bizdash_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: BizcardDashboardErrorCode.UNAUTHORIZED,
            message: "Authentication required",
            requestId,
            timestamp: new Date().toISOString(),
          },
        },
        { status: 401 }
      );
    }

    const params = request.nextUrl.searchParams;
    const rawFilter = (params.get("filter") ?? "today").trim().toLowerCase();
    if (!ALLOWED_FILTERS.has(rawFilter as DateFilterType)) {
      throw createBizcardDashboardError(
        BizcardDashboardErrorCode.INVALID_FILTER,
        "Invalid filter",
        400,
        requestId,
        { filter: rawFilter, allowed: [...ALLOWED_FILTERS] }
      );
    }

    const customStartDate = params.get("start_date") ?? undefined;
    const customEndDate = params.get("end_date") ?? undefined;

    const targetBizcard = params.get("bizcard_id") ?? params.get("serial_id") ?? undefined;
    const target = targetBizcard ? parseBizcardIdentifier(targetBizcard) : undefined;
    if (targetBizcard && !target) {
      throw createBizcardDashboardError(
        BizcardDashboardErrorCode.BIZCARD_NOT_FOUND,
        "Invalid bizcard identifier",
        400,
        requestId,
        { bizcard_id: targetBizcard }
      );
    }

    const rateLimit = checkBizcardDashboardRateLimit(
      request,
      target ? "GET_DASHBOARD_BY_ID" : "GET_DASHBOARD"
    );
    if (!rateLimit.success) {
      return NextResponse.json(
        toBizcardDashboardErrorResponse(
          BizcardDashboardErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many dashboard requests. Please try again later.",
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

    const service = new BizcardDashboardService(requestId, BigInt(auth.session.userId), target ?? undefined);
    const data = await service.getDashboardData(rawFilter as DateFilterType, customStartDate, customEndDate);

    const meta = {
      requestId,
      responseTime: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
      ip,
    };

    const response = NextResponse.json(
      serializeBizcardDashboardResponse({ success: true, data, meta })
    );
    return response;
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(
        toBizcardDashboardErrorResponse(
          error.code as unknown as BizcardDashboardErrorCode,
          error.message,
          requestId,
          error.details,
          Date.now() - startedAt
        ),
        { status: error.statusCode ?? 500 }
      );
    }

    if (error instanceof Error) {
      return NextResponse.json(
        toBizcardDashboardErrorResponse(
          BizcardDashboardErrorCode.INVALID_DATE_RANGE,
          error.message,
          requestId,
          undefined,
          Date.now() - startedAt
        ),
        { status: 400 }
      );
    }

    console.error("[user/dashboard] unexpected error", { requestId, error });
    return NextResponse.json(
      toBizcardDashboardErrorResponse(
        BizcardDashboardErrorCode.BIZCARD_NOT_FOUND,
        "Failed to fetch dashboard data",
        requestId,
        undefined,
        Date.now() - startedAt
      ),
      { status: 500 }
    );
  }
}
