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

async function parseBody(req: NextRequest, requestId: string): Promise<{ duration_days: number; reason: string }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.INVALID_DATE_RANGE,
      "Request body must be valid JSON",
      400,
      requestId
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.INVALID_DATE_RANGE,
      "Request body must be an object",
      400,
      requestId
    );
  }

  const payload = body as Record<string, unknown>;
  const durationDays = Number(payload.duration_days);
  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";

  if (!Number.isInteger(durationDays)) {
    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.INVALID_DATE_RANGE,
      "duration_days must be an integer",
      400,
      requestId,
      { duration_days: payload.duration_days }
    );
  }

  if (!reason) {
    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.INVALID_AFFILIATE_DATA,
      "reason is required",
      400,
      requestId
    );
  }

  return {
    duration_days: durationDays,
    reason,
  };
}

export const POST = withAffiliateSuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkAffiliateRateLimit(req, "RESTRICT", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toAffiliateMgmtErrorResponse(
          AffiliateMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many restrict requests. Please try again later.",
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
    const result = await service.restrictAffiliate(
      parsedAffiliateId,
      payload.duration_days,
      payload.reason,
      String(user.id),
      {
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      }
    );

    return NextResponse.json({
      success: true,
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
      "Failed to restrict affiliate"
    );
  }
});
