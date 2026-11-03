import { NextRequest, NextResponse } from "next/server";
import { getClientIp, getUserAgent } from "@/server/lib/auth";
import { withAffiliateSuperAdmin, type SuperAdminContext } from "@/lib/auth/superadmin-middleware";
import { AffiliateManagementService } from "@/lib/services/affiliate-management.service";
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

export const POST = withAffiliateSuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkAffiliateRateLimit(req, "UNRESTRICT", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toAffiliateMgmtErrorResponse(
          AffiliateMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many unrestrict requests. Please try again later.",
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

    const service = new AffiliateManagementService(requestId);
    const result = await service.unrestrictAffiliate(parsedAffiliateId, String(user.id), {
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
    });

    return NextResponse.json({
      success: true,
      message: "Affiliate restriction has been removed",
      data: result,
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
      "Failed to unrestrict affiliate"
    );
  }
});
