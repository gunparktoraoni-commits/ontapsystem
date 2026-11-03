import { NextRequest, NextResponse } from "next/server";
import { withAffiliateSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { AffiliateManagementService } from "@/lib/services/affiliate-management.service";
import { checkAffiliateRateLimit } from "@/lib/rate-limit/affiliate-limits";
import {
  AffiliateMgmtErrorCode,
  createAffiliateMgmtError,
  toAffiliateMgmtErrorResponse,
} from "@/lib/errors/affiliate-mgmt-errors";
import { toAffiliateMgmtErrorNextResponse } from "@/lib/errors/affiliate-mgmt-http";
import type { AffiliateCommissionListFilters } from "@/lib/services/affiliate-management.service";

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const VALID_SORT_FIELDS = new Set<AffiliateCommissionListFilters["sort_by"]>([
  "product_id",
  "affiliate_code",
  "affiliate_user_id",
  "affiliate_name",
  "commission_rate",
  "commission_amount",
  "status",
]);

const VALID_SORT_DIRS = new Set<AffiliateCommissionListFilters["sort_dir"]>(["asc", "desc"]);

export const GET = withAffiliateSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkAffiliateRateLimit(req, "LIST", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toAffiliateMgmtErrorResponse(
          AffiliateMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many affiliate commission requests. Please try again later.",
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

    const rawStatus = (params.get("status") ?? "all").toLowerCase();
    if (!["all", "pending", "approved", "paid", "voided"].includes(rawStatus)) {
      throw createAffiliateMgmtError(
        AffiliateMgmtErrorCode.INVALID_DATE_RANGE,
        "Invalid status. Allowed: all, pending, approved, paid, voided",
        400,
        requestId,
        { status: rawStatus }
      );
    }

    // Validate sort_by — unknown values silently fall back to default (created_at desc)
    const rawSortBy = (params.get("sort_by") ?? "").trim().toLowerCase() as AffiliateCommissionListFilters["sort_by"];
    const sortBy = rawSortBy && VALID_SORT_FIELDS.has(rawSortBy) ? rawSortBy : undefined;

    // Validate sort_dir — only "asc" or "desc" accepted
    const rawSortDir = (params.get("sort_dir") ?? "").trim().toLowerCase() as AffiliateCommissionListFilters["sort_dir"];
    const sortDir = rawSortDir && VALID_SORT_DIRS.has(rawSortDir) ? rawSortDir : undefined;

    const service = new AffiliateManagementService(requestId);
    const data = await service.listAffiliateCommissions({
      page: parsePositiveInt(params.get("page"), 1, 1, 100000),
      limit: parsePositiveInt(params.get("limit"), 20, 1, 100),
      search: params.get("search")?.trim() || undefined,
      status: rawStatus as "all" | "pending" | "approved" | "paid" | "voided",
      sort_by: sortBy,
      sort_dir: sortDir,
    });

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
      "Failed to fetch affiliate commissions"
    );
  }
});
