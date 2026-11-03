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

const enableTwoFactorSchema = z.object({
  secret: z.string().trim().min(1).max(128),
  verification_code: z.string().trim().min(6).max(8),
});

export const POST = withDashboardSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkSuperadminSettingsRateLimit(req, "TWO_FACTOR_ENABLE", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSettingsErrorResponse(
          SettingsErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many 2FA enable requests. Please try again later.",
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
    const parsed = enableTwoFactorSchema.safeParse(body);
    if (!parsed.success) {
      throw createSettingsError(
        SettingsErrorCode.INVALID_REQUEST_PAYLOAD,
        "Invalid 2FA enable payload",
        400,
        requestId,
        { issues: parsed.error.issues }
      );
    }

    const service = new SuperadminSettingsService(requestId);
    await service.enableTwoFactor(user.id, parsed.data.secret, parsed.data.verification_code);

    return NextResponse.json({
      success: true,
      data: { message: "Two-factor authentication enabled successfully" },
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return toSettingsErrorNextResponse(error, requestId, Date.now() - startedAt, "Failed to enable 2FA");
  }
});
