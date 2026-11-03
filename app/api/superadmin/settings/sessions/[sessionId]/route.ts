import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  SettingsErrorCode,
  createSettingsError,
  toSettingsErrorResponse,
} from "@/lib/errors/settings-errors";
import { toSettingsErrorNextResponse } from "@/lib/errors/settings-http";
import { checkSuperadminSettingsRateLimit } from "@/lib/rate-limit/superadmin-settings-limits";
import { SuperadminSettingsService } from "@/lib/services/superadmin-settings.service";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export const DELETE = withDashboardSuperAdmin<RouteContext>(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkSuperadminSettingsRateLimit(req, "SESSION_REVOKE", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSettingsErrorResponse(
          SettingsErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many session revoke requests. Please try again later.",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) },
        }
      );
    }

    const { sessionId } = await context.params;
    if (!sessionId || sessionId.trim().length === 0) {
      throw createSettingsError(
        SettingsErrorCode.INVALID_REQUEST_PAYLOAD,
        "sessionId path parameter is required",
        400,
        requestId
      );
    }

    const service = new SuperadminSettingsService(requestId);
    await service.revokeSession(user.id, sessionId.trim());

    return NextResponse.json({
      success: true,
      data: { message: "Session revoked successfully" },
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return toSettingsErrorNextResponse(error, requestId, Date.now() - startedAt, "Failed to revoke session");
  }
});
