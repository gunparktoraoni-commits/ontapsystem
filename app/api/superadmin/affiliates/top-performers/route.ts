import { NextRequest, NextResponse } from "next/server";
import { withAffiliateSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { AffiliateManagementService } from "@/lib/services/affiliate-management.service";
import { checkAffiliateRateLimit } from "@/lib/rate-limit/affiliate-limits";
import { AffiliateMgmtErrorCode, toAffiliateMgmtErrorResponse } from "@/lib/errors/affiliate-mgmt-errors";
import { toAffiliateMgmtErrorNextResponse } from "@/lib/errors/affiliate-mgmt-http";

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export const GET = withAffiliateSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkAffiliateRateLimit(req, "TOP_PERFORMERS", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toAffiliateMgmtErrorResponse(
          AffiliateMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many top performer requests. Please try again later.",
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

    const limit = parsePositiveInt(req.nextUrl.searchParams.get("limit"), 10, 1, 50);

    const service = new AffiliateManagementService(requestId);
    const data = await service.getTopPerformingAffiliates(limit);

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
      "Failed to fetch top performing affiliates"
    );
  }
});

