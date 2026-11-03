import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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

const updatePaymentChannelSchema = z.object({
  bank_name: z.string().trim().min(1).max(100).optional(),
  account_name: z.string().trim().min(1).max(255).optional(),
  account_number: z.string().trim().min(4).max(64).optional(),
  account_type: z.enum(["checking", "savings", "business"]).optional(),
  routing_number: z.string().trim().max(64).optional(),
  swift_code: z.string().trim().max(50).optional(),
  is_default: z.boolean().optional(),
});

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

export const PUT = withDashboardSuperAdmin<RouteContext>(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkSuperadminSettingsRateLimit(req, "PAYMENT_CHANNELS_UPDATE", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSettingsErrorResponse(
          SettingsErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many payment channel update requests. Please try again later.",
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

    const body = await req.json().catch(() => null);
    const parsed = updatePaymentChannelSchema.safeParse(body);
    if (!parsed.success) {
      throw createSettingsError(
        SettingsErrorCode.INVALID_REQUEST_PAYLOAD,
        "Invalid payment channel update payload",
        400,
        requestId,
        { issues: parsed.error.issues }
      );
    }

    const service = new SuperadminSettingsService(requestId);
    const data = await service.updatePaymentChannel(user.id, parsedChannelId, parsed.data);

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
    return toSettingsErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to update payment channel"
    );
  }
});

export const DELETE = withDashboardSuperAdmin<RouteContext>(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkSuperadminSettingsRateLimit(req, "PAYMENT_CHANNELS_DELETE", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSettingsErrorResponse(
          SettingsErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many payment channel delete requests. Please try again later.",
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
    await service.deletePaymentChannel(user.id, parsedChannelId);

    return NextResponse.json({
      success: true,
      data: { message: "Payment channel deleted successfully" },
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
      "Failed to delete payment channel"
    );
  }
});
