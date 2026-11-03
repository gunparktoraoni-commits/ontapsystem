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

const changePasswordSchema = z
  .object({
    current_password: z.string().min(1).max(256),
    new_password: z.string().min(1).max(256),
    confirm_password: z.string().min(1).max(256),
  })
  .superRefine((value, ctx) => {
    if (value.new_password !== value.confirm_password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "confirm_password must match new_password",
        path: ["confirm_password"],
      });
    }
  });

export const POST = withDashboardSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkSuperadminSettingsRateLimit(req, "CHANGE_PASSWORD", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSettingsErrorResponse(
          SettingsErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many password change requests. Please try again later.",
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
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw createSettingsError(
        SettingsErrorCode.INVALID_REQUEST_PAYLOAD,
        "Invalid change password payload",
        400,
        requestId,
        { issues: parsed.error.issues }
      );
    }

    const service = new SuperadminSettingsService(requestId);
    await service.changePassword(user.id, parsed.data.current_password, parsed.data.new_password);

    return NextResponse.json({
      success: true,
      data: { message: "Password changed successfully" },
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
      "Failed to change password"
    );
  }
});
