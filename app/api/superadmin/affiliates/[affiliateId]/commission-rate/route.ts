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

async function parseBody(req: NextRequest, requestId: string): Promise<{ commission_rate: number }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.INVALID_COMMISSION_RATE,
      "Request body must be valid JSON",
      400,
      requestId
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.INVALID_COMMISSION_RATE,
      "Request body must be an object",
      400,
      requestId
    );
  }

  const payload = body as Record<string, unknown>;
  const commissionRate = Number(payload.commission_rate);
  if (!Number.isFinite(commissionRate)) {
    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.INVALID_COMMISSION_RATE,
      "commission_rate must be a number",
      400,
      requestId,
      { commission_rate: payload.commission_rate }
    );
  }

  return { commission_rate: commissionRate };
}

export const PUT = withAffiliateSuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkAffiliateRateLimit(req, "UPDATE_COMMISSION", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toAffiliateMgmtErrorResponse(
          AffiliateMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many commission update requests. Please try again later.",
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
    const payload = await parseBody(req, requestId);

    const service = new AffiliateManagementService(requestId);
    const result = await service.updateAffiliateCommissionRate(
      parsedAffiliateId,
      payload.commission_rate,
      String(user.id),
      {
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      }
    );

    return NextResponse.json({
      success: true,
      message: result.message,
      data: {
        affiliate_id: result.affiliate_id,
        commission_rate: result.commission_rate,
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
      "Failed to update affiliate commission rate"
    );
  }
});
