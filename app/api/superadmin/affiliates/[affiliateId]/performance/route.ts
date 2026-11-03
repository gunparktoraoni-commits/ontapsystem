import { NextRequest, NextResponse } from "next/server";
import { withAffiliateSuperAdmin, type SuperAdminContext } from "@/lib/auth/superadmin-middleware";
import { AffiliateManagementService, type PeriodType } from "@/lib/services/affiliate-management.service";
import { checkAffiliateRateLimit } from "@/lib/rate-limit/affiliate-limits";
import {
  AffiliateMgmtErrorCode,
  createAffiliateMgmtError,
  toAffiliateMgmtErrorResponse,
} from "@/lib/errors/affiliate-mgmt-errors";
import { toAffiliateMgmtErrorNextResponse } from "@/lib/errors/affiliate-mgmt-http";

type RouteContext = SuperAdminContext & {
  params: Promise<{ affiliateId: string }>;
};

function parseAffiliateId(raw: string, requestId: string): number {
  if (!/^\d+$/.test(raw)) {
    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.INVALID_DATE_RANGE,
      "Invalid affiliateId path parameter",
      400,
      requestId,
      { affiliateId: raw }
    );
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.INVALID_DATE_RANGE,
      "Invalid affiliateId path parameter",
      400,
      requestId,
      { affiliateId: raw }
    );
  }

  return parsed;
}

function parsePeriod(value: string | null, requestId: string): PeriodType {
  const period = (value ?? "this_month").toLowerCase();
  if (
    period !== "today" &&
    period !== "this_week" &&
    period !== "this_month" &&
    period !== "last_month" &&
    period !== "custom"
  ) {
    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.INVALID_DATE_RANGE,
      "Invalid period. Allowed: today, this_week, this_month, last_month, custom",
      400,
      requestId,
      { period: value }
    );
  }
  return period as PeriodType;
}

export const GET = withAffiliateSuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkAffiliateRateLimit(req, "PERFORMANCE", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toAffiliateMgmtErrorResponse(
          AffiliateMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many performance requests. Please try again later.",
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

    const { affiliateId } = await context.params;
    const parsedAffiliateId = parseAffiliateId(affiliateId, requestId);

    const params = req.nextUrl.searchParams;
    const period = parsePeriod(params.get("period"), requestId);

    const service = new AffiliateManagementService(requestId);
    const data = await service.getAffiliatePerformance(
      parsedAffiliateId,
      period,
      params.get("start_date") ?? undefined,
      params.get("end_date") ?? undefined
    );

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
    return toAffiliateMgmtErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to fetch affiliate performance"
    );
  }
});
