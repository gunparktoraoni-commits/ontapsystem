import { NextRequest, NextResponse } from "next/server";
import { getClientIp, getUserAgent } from "@/server/lib/auth";
import { withAffiliateSuperAdmin, type SuperAdminContext } from "@/lib/auth/superadmin-middleware";
import {
  AffiliateManagementService,
  type AffiliateDetailRange,
} from "@/lib/services/affiliate-management.service";
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

function parseDetailRange(raw: string | null, requestId: string): AffiliateDetailRange {
  const value = (raw ?? "last_6_months").toLowerCase();
  if (
    value !== "this_month" &&
    value !== "last_3_months" &&
    value !== "last_6_months" &&
    value !== "last_12_months"
  ) {
    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.INVALID_DATE_RANGE,
      "Invalid range. Allowed: this_month, last_3_months, last_6_months, last_12_months",
      400,
      requestId,
      { range: raw }
    );
  }
  return value;
}

async function parseUpdateBody(
  req: NextRequest,
  requestId: string
): Promise<{
  first_name?: string;
  last_name?: string;
  email?: string;
  commission_rate?: number;
}> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.INVALID_AFFILIATE_DATA,
      "Request body must be valid JSON",
      400,
      requestId
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.INVALID_AFFILIATE_DATA,
      "Request body must be an object",
      400,
      requestId
    );
  }

  const payload = body as Record<string, unknown>;
  const updateData: {
    first_name?: string;
    last_name?: string;
    email?: string;
    commission_rate?: number;
  } = {};

  if (payload.first_name !== undefined) {
    if (typeof payload.first_name !== "string") {
      throw createAffiliateMgmtError(
        AffiliateMgmtErrorCode.INVALID_AFFILIATE_DATA,
        "first_name must be a string",
        400,
        requestId,
        { first_name: payload.first_name }
      );
    }
    updateData.first_name = payload.first_name.trim();
  }

  if (payload.last_name !== undefined) {
    if (typeof payload.last_name !== "string") {
      throw createAffiliateMgmtError(
        AffiliateMgmtErrorCode.INVALID_AFFILIATE_DATA,
        "last_name must be a string",
        400,
        requestId,
        { last_name: payload.last_name }
      );
    }
    updateData.last_name = payload.last_name.trim();
  }

  if (payload.email !== undefined) {
    if (typeof payload.email !== "string") {
      throw createAffiliateMgmtError(
        AffiliateMgmtErrorCode.INVALID_AFFILIATE_DATA,
        "email must be a string",
        400,
        requestId,
        { email: payload.email }
      );
    }
    const email = payload.email.trim();
    if (!email || !email.includes("@")) {
      throw createAffiliateMgmtError(
        AffiliateMgmtErrorCode.INVALID_AFFILIATE_DATA,
        "email must be a valid email address",
        400,
        requestId,
        { email: payload.email }
      );
    }
    updateData.email = email;
  }

  if (payload.commission_rate !== undefined) {
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
    updateData.commission_rate = commissionRate;
  }

  return updateData;
}

export const GET = withAffiliateSuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkAffiliateRateLimit(req, "DETAIL", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toAffiliateMgmtErrorResponse(
          AffiliateMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many affiliate detail requests. Please try again later.",
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
    const range = parseDetailRange(req.nextUrl.searchParams.get("range"), requestId);

    const service = new AffiliateManagementService(requestId);
    const detail = await service.getAffiliateDetails(parsedAffiliateId, range);

    return NextResponse.json({
      success: true,
      data: detail,
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
      "Failed to fetch affiliate details"
    );
  }
});

export const PUT = withAffiliateSuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkAffiliateRateLimit(req, "UPDATE", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toAffiliateMgmtErrorResponse(
          AffiliateMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many affiliate update requests. Please try again later.",
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
    const payload = await parseUpdateBody(req, requestId);

    const service = new AffiliateManagementService(requestId);
    const data = await service.updateAffiliate(parsedAffiliateId, payload, String(user.id), {
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
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
      "Failed to update affiliate"
    );
  }
});
