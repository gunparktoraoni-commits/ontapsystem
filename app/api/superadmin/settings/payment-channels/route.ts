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

const createPaymentChannelSchema = z.object({
  bank_name: z.string().trim().min(1).max(100),
  account_name: z.string().trim().min(1).max(255),
  account_number: z.string().trim().min(4).max(64),
  account_type: z.enum(["checking", "savings", "business"]).optional(),
  routing_number: z.string().trim().max(64).optional(),
  swift_code: z.string().trim().max(50).optional(),
  is_default: z.boolean().optional(),
});

export const GET = withDashboardSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkSuperadminSettingsRateLimit(req, "PAYMENT_CHANNELS_READ", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSettingsErrorResponse(
          SettingsErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many payment channel requests. Please try again later.",
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

    const service = new SuperadminSettingsService(requestId);
    const data = await service.getPaymentChannels(user.id);

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
    return toSettingsErrorNextResponse(error, requestId, Date.now() - startedAt, "Failed to get payment channels");
  }
});

export const POST = withDashboardSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkSuperadminSettingsRateLimit(req, "PAYMENT_CHANNELS_CREATE", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSettingsErrorResponse(
          SettingsErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many payment channel create requests. Please try again later.",
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

    const body = await req.json().catch(() => null);
    const parsed = createPaymentChannelSchema.safeParse(body);
    if (!parsed.success) {
      throw createSettingsError(
        SettingsErrorCode.INVALID_REQUEST_PAYLOAD,
        "Invalid payment channel payload",
        400,
        requestId,
        { issues: parsed.error.issues }
      );
    }

    const service = new SuperadminSettingsService(requestId);
    const data = await service.addPaymentChannel(user.id, parsed.data);

    return NextResponse.json({
      success: true,
      data,
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    }, { status: 201 });
  } catch (error) {
    return toSettingsErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to create payment channel"
    );
  }
});
