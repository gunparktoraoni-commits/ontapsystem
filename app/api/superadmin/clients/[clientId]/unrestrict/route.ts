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

export const POST = withSuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkClientRateLimit(req, "UNRESTRICT", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toClientErrorResponse(
          ClientErrorCode.RATE_LIMIT_EXCEEDED,
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

    const { clientId } = await context.params;
    const parsedClientId = parseClientId(clientId, requestId);

    const service = new ClientManagementService(requestId);
    const result = await service.unrestrictClient(parsedClientId, String(user.id), {
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
    });

    return NextResponse.json({
      success: true,
      message: "Client restriction has been removed",
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
      "Failed to unrestrict client"
    );
  }
});
