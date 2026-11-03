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

const frequencySchema = z.enum(["daily", "weekly", "semi_monthly", "monthly"]);

const notificationsUpdateSchema = z.object({
  user_activity: z
    .object({
      new_registration: z.boolean().optional(),
      user_report_frequency: frequencySchema.optional(),
      inactive_users: z.boolean().optional(),
      transactions: z.boolean().optional(),
      company_requests: z.boolean().optional(),
    })
    .optional(),
  security: z
    .object({
      multiple_devices: z.boolean().optional(),
      security_report_frequency: frequencySchema.optional(),
      staff_device_login: z.boolean().optional(),
      account_lockouts: z.boolean().optional(),
    })
    .optional(),
  staff_activity: z
    .object({
      company_changes: z.boolean().optional(),
      user_record_modifications: z.boolean().optional(),
      staff_activity_report_frequency: frequencySchema.optional(),
      staff_password_changes: z.boolean().optional(),
    })
    .optional(),
  system_health: z
    .object({
      server_downtime: z.boolean().optional(),
      page_load_speed: z.boolean().optional(),
      high_error_rates: z.boolean().optional(),
      failed_cron_jobs: z.boolean().optional(),
      system_health_report_frequency: frequencySchema.optional(),
    })
    .optional(),
  affiliate: z
    .object({
      payout_alerts: z.boolean().optional(),
      most_used_codes: z.boolean().optional(),
      affiliate_report_frequency: frequencySchema.optional(),
    })
    .optional(),
  transaction: z
    .object({
      new_bizcard_orders: z.boolean().optional(),
      new_subscriptions: z.boolean().optional(),
      cancelled_orders: z.boolean().optional(),
      completed_orders: z.boolean().optional(),
      order_report_frequency: frequencySchema.optional(),
    })
    .optional(),
});

export const GET = withDashboardSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkSuperadminSettingsRateLimit(req, "NOTIFICATIONS_READ", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSettingsErrorResponse(
          SettingsErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many notification preference requests. Please try again later.",
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
    const data = await service.getNotificationPreferences(user.id);

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
      "Failed to get notification preferences"
    );
  }
});

export const PUT = withDashboardSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkSuperadminSettingsRateLimit(req, "NOTIFICATIONS_UPDATE", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSettingsErrorResponse(
          SettingsErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many notification preference update requests. Please try again later.",
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
    const parsed = notificationsUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw createSettingsError(
        SettingsErrorCode.INVALID_REQUEST_PAYLOAD,
        "Invalid notification preferences payload",
        400,
        requestId,
        { issues: parsed.error.issues }
      );
    }

    const service = new SuperadminSettingsService(requestId);
    const data = await service.updateNotificationPreferences(user.id, parsed.data);

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
      "Failed to update notification preferences"
    );
  }
});
