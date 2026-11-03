import { NextRequest, NextResponse } from "next/server";
import { withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { ClientManagementService } from "@/lib/services/client-management.service";
import { checkClientRateLimit } from "@/lib/rate-limit/client-limits";
import { ClientErrorCode, toClientErrorResponse } from "@/lib/errors/client-errors";
import { toClientErrorNextResponse } from "@/lib/errors/client-http";

export const GET = withSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkClientRateLimit(req, "SUMMARY", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toClientErrorResponse(
          ClientErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many client summary requests. Please try again later.",
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

    const service = new ClientManagementService(requestId);
    const summary = await service.getClientSummary();

    return NextResponse.json({
      success: true,
      data: summary,
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
      "Failed to fetch client summary"
    );
  }
});
