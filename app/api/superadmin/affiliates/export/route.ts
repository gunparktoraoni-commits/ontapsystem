import { NextRequest, NextResponse } from "next/server";
import { withAffiliateSuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  AffiliateManagementService,
  type PeriodType,
} from "@/lib/services/affiliate-management.service";
import { checkAffiliateRateLimit } from "@/lib/rate-limit/affiliate-limits";
import {
  AffiliateMgmtErrorCode,
  createAffiliateMgmtError,
  toAffiliateMgmtErrorResponse,
} from "@/lib/errors/affiliate-mgmt-errors";
import { toAffiliateMgmtErrorNextResponse } from "@/lib/errors/affiliate-mgmt-http";

function parsePeriod(value: string | null, requestId: string): PeriodType | undefined {
  if (!value) return undefined;
  const period = value.toLowerCase();
  if (
    period !== "today" &&
    period !== "yesterday" &&
    period !== "this_week" &&
    period !== "this_month" &&
    period !== "last_month" &&
    period !== "custom"
  ) {
    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.INVALID_DATE_RANGE,
      "Invalid period. Allowed: today, yesterday, this_week, this_month, last_month, custom",
      400,
      requestId,
      { period: value }
    );
  }
  return period as PeriodType;
}

export const GET = withAffiliateSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkAffiliateRateLimit(req, "EXPORT", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toAffiliateMgmtErrorResponse(
          AffiliateMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many export requests. Please try again later.",
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
    if (format !== "csv") {
      throw createAffiliateMgmtError(
        AffiliateMgmtErrorCode.INVALID_DATE_RANGE,
        "Invalid format. Allowed: csv",
        400,
        requestId,
        { format }
      );
    }

    const status = (params.get("status") ?? "all").trim().toLowerCase();
    if (status !== "all" && status !== "active" && status !== "restricted") {
      throw createAffiliateMgmtError(
        AffiliateMgmtErrorCode.INVALID_DATE_RANGE,
        "Invalid status. Allowed: all, active, restricted",
        400,
        requestId,
        { status }
      );
    }

    const requestedFilter = (params.get("filter") ?? "all").trim().toLowerCase();
    if (requestedFilter !== "all" && requestedFilter !== "specific") {
      throw createAffiliateMgmtError(
        AffiliateMgmtErrorCode.INVALID_DATE_RANGE,
        "Invalid filter. Allowed: all, specific",
        400,
        requestId,
        { filter: requestedFilter }
      );
    }

    const dateFilter = params.get("date_filter")?.trim().toLowerCase() ?? undefined;
    const period = parsePeriod(dateFilter ?? params.get("period"), requestId);

    const affiliateName = params.get("affiliate_name")?.trim();
    const search =
      requestedFilter === "specific"
        ? affiliateName || undefined
        : params.get("search")?.trim() || undefined;

    const service = new AffiliateManagementService(requestId);
    const fileBuffer = await service.exportAffiliates({
      search,
      status: status as "all" | "active" | "restricted",
      period,
      start_date: params.get("start_date") ?? undefined,
      end_date: params.get("end_date") ?? undefined,
      sort_by: "joined_at",
      sort_dir: "desc",
    });

    const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const fileName = `affiliates_export_${dateStamp}.csv`;

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(fileBuffer.byteLength),
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    return toAffiliateMgmtErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to export affiliates"
    );
  }
});

