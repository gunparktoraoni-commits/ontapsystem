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
import { resolveRequestSession } from "@/server/lib/auth";

const DEVICE_PLATFORMS = ["Windows", "macOS", "Linux", "iOS", "Android"] as const;

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  device: z.enum(DEVICE_PLATFORMS).optional(),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
});

function parseDateQueryParam(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (!value) return undefined;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export const GET = withDashboardSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkSuperadminSettingsRateLimit(req, "LOGIN_HISTORY_READ", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSettingsErrorResponse(
          SettingsErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many login history requests. Please try again later.",
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

    const parsed = querySchema.safeParse({
      page: req.nextUrl.searchParams.get("page") ?? "1",
      limit: req.nextUrl.searchParams.get("limit") ?? "20",
      from: req.nextUrl.searchParams.get("from") ?? undefined,
      to: req.nextUrl.searchParams.get("to") ?? undefined,
      device: req.nextUrl.searchParams.get("device") ?? undefined,
      active: req.nextUrl.searchParams.get("active") ?? undefined,
    });

    if (!parsed.success) {
      throw createSettingsError(
        SettingsErrorCode.INVALID_REQUEST_PAYLOAD,
        "Invalid login history query parameters",
        400,
        requestId,
        { issues: parsed.error.issues }
      );
    }

    const from = parseDateQueryParam(parsed.data.from, false);
    const to = parseDateQueryParam(parsed.data.to, true);

    if (parsed.data.from && !from) {
      throw createSettingsError(
        SettingsErrorCode.INVALID_REQUEST_PAYLOAD,
        "Invalid from date parameter",
        400,
        requestId,
        { from: parsed.data.from }
      );
    }

    if (parsed.data.to && !to) {
      throw createSettingsError(
        SettingsErrorCode.INVALID_REQUEST_PAYLOAD,
        "Invalid to date parameter",
        400,
        requestId,
        { to: parsed.data.to }
      );
    }

    const auth = await resolveRequestSession(req, { tryRefresh: true });
    const currentSessionId = auth.session ? String(auth.session.sessionId) : null;

    const service = new SuperadminSettingsService(requestId);
    const data = await service.getLoginHistory(user.id, parsed.data.page, parsed.data.limit, {
      from,
      to,
      device: parsed.data.device,
      active: parsed.data.active,
    });

    return NextResponse.json({
      success: true,
      data: {
        ...data,
        current_session_id: currentSessionId,
      },
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return toSettingsErrorNextResponse(error, requestId, Date.now() - startedAt, "Failed to get login history");
  }
});
