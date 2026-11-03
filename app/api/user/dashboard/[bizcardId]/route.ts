import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession } from "@/server/lib/auth";
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bizcardId: string }> }
) {
  const requestId = `bizdash_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  try {
    const rateLimit = checkBizcardDashboardRateLimit(request, "GET_DASHBOARD_BY_ID");
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

    const rawParams = await params;
    const target = parseBizcardIdentifier(rawParams.bizcardId);
    if (!target) {
      throw createBizcardDashboardError(
        BizcardDashboardErrorCode.BIZCARD_NOT_FOUND,
        "Bizcard not found",
        404,
        requestId,
        { bizcardId: rawParams.bizcardId }
      );
    }

    const paramsObj = request.nextUrl.searchParams;
    const rawFilter = (paramsObj.get("filter") ?? "today").trim().toLowerCase();
    if (!ALLOWED_FILTERS.has(rawFilter as DateFilterType)) {
      throw createBizcardDashboardError(
        BizcardDashboardErrorCode.INVALID_FILTER,
        "Invalid filter",
        400,
        requestId,
        { filter: rawFilter, allowed: [...ALLOWED_FILTERS] }
      );
    }

    const customStartDate = paramsObj.get("start_date") ?? undefined;
    const customEndDate = paramsObj.get("end_date") ?? undefined;

    const service = new BizcardDashboardService(requestId, BigInt(auth.session.userId), target);
    const data = await service.getDashboardData(rawFilter as DateFilterType, customStartDate, customEndDate);

    return NextResponse.json(
      serializeBizcardDashboardResponse({
        success: true,
        data,
        meta: {
          requestId,
          responseTime: Date.now() - startedAt,
          timestamp: new Date().toISOString(),
        },
      })
    );
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
