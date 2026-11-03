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
  params: Promise<{ channelId: string }>;
};

function parseChannelId(raw: string, requestId: string): number {
  if (!/^\d+$/.test(raw)) {
    throw createSettingsError(
      SettingsErrorCode.INVALID_REQUEST_PAYLOAD,
      "Invalid channelId path parameter",
      400,
      requestId,
      { channelId: raw }
    );
  }

  return Number(raw);
}

export const POST = withDashboardSuperAdmin<RouteContext>(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkSuperadminSettingsRateLimit(req, "PAYMENT_CHANNELS_SET_DEFAULT", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSettingsErrorResponse(
          SettingsErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many default payment channel requests. Please try again later.",
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

    const { channelId } = await context.params;
    const parsedChannelId = parseChannelId(channelId, requestId);

    const service = new SuperadminSettingsService(requestId);
    await service.setDefaultPaymentChannel(user.id, parsedChannelId);

    return NextResponse.json({
      success: true,
      data: { message: "Default payment channel set successfully" },
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return toSettingsErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to set default payment channel"
    );
  }
});
