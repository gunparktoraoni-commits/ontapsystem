import { NextRequest, NextResponse } from "next/server";
import { getClientIp, getUserAgent } from "@/server/lib/auth";
import { withSuperAdmin, type SuperAdminContext } from "@/lib/auth/superadmin-middleware";
import { ClientManagementService } from "@/lib/services/client-management.service";
import { checkClientRateLimit } from "@/lib/rate-limit/client-limits";
import { ClientErrorCode, createClientError, toClientErrorResponse } from "@/lib/errors/client-errors";
import { toClientErrorNextResponse } from "@/lib/errors/client-http";

type RouteContext = SuperAdminContext & {
  params: Promise<{ clientId: string }>;
};

function parseClientId(raw: string, requestId: string): number {
  if (!/^\d+$/.test(raw)) {
    throw createClientError(ClientErrorCode.INVALID_PAGINATION, "Invalid clientId path parameter", 400, requestId, { clientId: raw });
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw createClientError(ClientErrorCode.INVALID_PAGINATION, "Invalid clientId path parameter", 400, requestId, { clientId: raw });
  }

  return parsed;
}

async function parseRestrictBody(req: NextRequest, requestId: string): Promise<{ duration_days: number; reason: string }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw createClientError(ClientErrorCode.INVALID_PAGINATION, "Request body must be valid JSON", 400, requestId);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createClientError(ClientErrorCode.INVALID_PAGINATION, "Request body must be an object", 400, requestId);
  }

  const payload = body as Record<string, unknown>;
  const durationDays = Number(payload.duration_days);
  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";

  if (!Number.isInteger(durationDays)) {
    throw createClientError(
      ClientErrorCode.INVALID_RESTRICTION_DURATION,
      "duration_days must be an integer",
      400,
      requestId,
      { duration_days: payload.duration_days }
    );
  }

  if (reason.length === 0) {
    throw createClientError(
      ClientErrorCode.INVALID_RESTRICTION_DURATION,
      "reason is required",
      400,
      requestId
    );
  }

  if (reason.length > 500) {
    throw createClientError(
      ClientErrorCode.INVALID_RESTRICTION_DURATION,
      "reason must be at most 500 characters",
      400,
      requestId,
      { length: reason.length }
    );
  }

  return { duration_days: durationDays, reason };
}

export const POST = withSuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkClientRateLimit(req, "RESTRICT", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toClientErrorResponse(
          ClientErrorCode.RATE_LIMIT_EXCEEDED,
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

    const { clientId } = await context.params;
    const parsedClientId = parseClientId(clientId, requestId);
    const payload = await parseRestrictBody(req, requestId);

    const service = new ClientManagementService(requestId);
    const result = await service.restrictClient(
      parsedClientId,
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
    return toClientErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to restrict client"
    );
  }
});
