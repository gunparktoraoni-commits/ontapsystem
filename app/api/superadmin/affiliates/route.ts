import { NextRequest, NextResponse } from "next/server";
import { withAffiliateSuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  AffiliateManagementService,
  type AffiliateListFilters,
  type PeriodType,
} from "@/lib/services/affiliate-management.service";
import { checkAffiliateRateLimit } from "@/lib/rate-limit/affiliate-limits";
import {
  AffiliateMgmtErrorCode,
  createAffiliateMgmtError,
  toAffiliateMgmtErrorResponse,
} from "@/lib/errors/affiliate-mgmt-errors";
import { toAffiliateMgmtErrorNextResponse } from "@/lib/errors/affiliate-mgmt-http";

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseFilters(req: NextRequest, requestId: string): AffiliateListFilters {
  const params = req.nextUrl.searchParams;
  const page = parsePositiveInt(params.get("page"), 1, 1, 100000);
  const limit = parsePositiveInt(params.get("limit"), 20, 1, 100);
  const search = params.get("search")?.trim() || undefined;

  const rawStatus = (params.get("status") ?? "all").toLowerCase();
  if (rawStatus !== "all" && rawStatus !== "active" && rawStatus !== "restricted") {
    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.INVALID_DATE_RANGE,
      "Invalid status. Allowed: all, active, restricted",
      400,
      requestId,
      { status: rawStatus }
    );
  }

  const rawSortBy = (params.get("sort_by") ?? "total_referrals").toLowerCase();
  if (
    rawSortBy !== "total_earnings" &&
    rawSortBy !== "total_referrals" &&
    rawSortBy !== "successful_referrals" &&
    rawSortBy !== "conversion_rate" &&
    rawSortBy !== "joined_at"
  ) {
    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.INVALID_DATE_RANGE,
      "Invalid sort_by. Allowed: total_earnings, total_referrals, successful_referrals, conversion_rate, joined_at",
      400,
      requestId,
      { sort_by: rawSortBy }
    );
  }

  const rawSortDir = (params.get("sort_dir") ?? "desc").toLowerCase();
  if (rawSortDir !== "asc" && rawSortDir !== "desc") {
    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.INVALID_DATE_RANGE,
      "Invalid sort_dir. Allowed: asc, desc",
      400,
      requestId,
      { sort_dir: rawSortDir }
    );
  }

  const rawPeriod = params.get("period");
  let period: PeriodType | undefined;
  if (rawPeriod) {
    const normalizedPeriod = rawPeriod.toLowerCase();
    if (
      normalizedPeriod !== "today" &&
      normalizedPeriod !== "yesterday" &&
      normalizedPeriod !== "this_week" &&
      normalizedPeriod !== "this_month" &&
      normalizedPeriod !== "last_month" &&
      normalizedPeriod !== "custom"
    ) {
      throw createAffiliateMgmtError(
        AffiliateMgmtErrorCode.INVALID_DATE_RANGE,
        "Invalid period. Allowed: today, yesterday, this_week, this_month, last_month, custom",
        400,
        requestId,
        { period: rawPeriod }
      );
    }
    period = normalizedPeriod as PeriodType;
  }

  return {
    page,
    limit,
    search,
    status: rawStatus as AffiliateListFilters["status"],
    sort_by: rawSortBy as AffiliateListFilters["sort_by"],
    sort_dir: rawSortDir as AffiliateListFilters["sort_dir"],
    period,
    start_date: params.get("start_date") ?? undefined,
    end_date: params.get("end_date") ?? undefined,
  };
}

export const GET = withAffiliateSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkAffiliateRateLimit(req, "LIST", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toAffiliateMgmtErrorResponse(
          AffiliateMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many affiliate list requests. Please try again later.",
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
    const service = new AffiliateManagementService(requestId);
    const result = await service.getAffiliates(filters);

    const affiliates = result.affiliates.map((affiliate, index) => ({
      rank: (result.pagination.page - 1) * result.pagination.limit + index + 1,
      affiliate_id: affiliate.affiliate_id,
      user_id: affiliate.affiliate_id,
      name: affiliate.name,
      email: affiliate.email,
      affiliate_code: affiliate.affiliate_code ?? null,
      commission_rate: affiliate.commission_rate,
      successful_referrals: affiliate.successful_referrals,
      total_referrals: affiliate.total_referrals,
      commission_received: affiliate.total_earnings,
      total_earnings: affiliate.total_earnings,
      date_started: affiliate.joined_at,
      is_restricted: affiliate.status === "restricted",
      status: affiliate.status,
      profile_image: affiliate.profile_image ?? null,
      serial_id: affiliate.serial_id,
      subscription: affiliate.subscription,
      portfolio_url: affiliate.portfolio_url,
      tags: affiliate.tags,
    }));

    return NextResponse.json({
      success: true,
      data: {
        affiliates,
        pagination: result.pagination,
      },
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
      "Failed to fetch affiliates"
    );
  }
});

