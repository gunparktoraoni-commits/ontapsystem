import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  SuperAdminErrorCode,
  createSuperAdminError,
} from "@/lib/errors/superadmin-errors";
import { toSuperAdminErrorNextResponse } from "@/lib/errors/superadmin-http";
import { getClientIp, getUserAgent } from "@/server/lib/auth";
import {
  PASSWORD_VIEW_MODES,
  SuperadminPasswordViewService,
} from "@/lib/services/superadmin-password-view.service";

type RouteContext = {
  params: Promise<{ userId: string }>;
};

function parseUserId(raw: string, requestId: string): number {
  if (!/^\d+$/.test(raw)) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "userId must be a positive integer.",
      400,
      requestId,
      { userId: raw },
    );
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "userId must be a positive integer.",
      400,
      requestId,
      { userId: raw },
    );
  }
  return parsed;
}

const revealSchema = z.object({
  superadmin_password: z.string().min(1).max(128).optional(),
  mode: z.enum(PASSWORD_VIEW_MODES).optional(),
  duration_hours: z.number().int().min(1).max(24 * 365).optional(),
});

export const POST = withDashboardSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const params = await (context as typeof context & RouteContext).params;
    const targetUserId = parseUserId(params.userId, requestId);
    const body = await req.json().catch(() => ({}));
    const parsed = revealSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        "Invalid password reveal payload.",
        400,
        requestId,
        { issues: parsed.error.issues },
      );
    }

    const service = new SuperadminPasswordViewService(requestId);
    const data = await service.revealPassword({
      superadminUserId: user.id,
      targetUserId,
      superadminPassword: parsed.data.superadmin_password,
      mode: parsed.data.mode,
      durationHours: parsed.data.duration_hours,
      ip: getClientIp(req),
      userAgent: getUserAgent(req),
    });

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
    return toSuperAdminErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to reveal user password",
    );
  }
});
