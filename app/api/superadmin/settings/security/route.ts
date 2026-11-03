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

const securityUpdateSchema = z.object({
  auto_logout_minutes: z.number().int().min(1).max(10080).optional(),
  login_notifications: z.boolean().optional(),
  password_rotation_days: z.number().int().min(1).max(365).optional(),
  suspicious_ips: z.array(z.string().trim().max(64)).max(100).optional(),
});

export const GET = withDashboardSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkSuperadminSettingsRateLimit(req, "SECURITY_READ", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSettingsErrorResponse(
          SettingsErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many security settings requests. Please try again later.",
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
    const data = await service.getSecuritySettings(user.id);

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
      "Failed to get security settings"
    );
  }
});

export const PUT = withDashboardSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkSuperadminSettingsRateLimit(req, "SECURITY_UPDATE", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSettingsErrorResponse(
          SettingsErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many security settings update requests. Please try again later.",
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
    const parsed = securityUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw createSettingsError(
        SettingsErrorCode.INVALID_REQUEST_PAYLOAD,
        "Invalid security settings payload",
        400,
        requestId,
        { issues: parsed.error.issues }
      );
    }

    const service = new SuperadminSettingsService(requestId);
    const data = await service.updateSecuritySettings(user.id, parsed.data);

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
      "Failed to update security settings"
    );
  }
});
