import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  SuperAdminErrorCode,
  createSuperAdminError,
} from "@/lib/errors/superadmin-errors";
import { toSuperAdminErrorNextResponse } from "@/lib/errors/superadmin-http";
import {
  PASSWORD_VIEW_MODES,
  SuperadminPasswordViewService,
} from "@/lib/services/superadmin-password-view.service";

const preferenceSchema = z.object({
  mode: z.enum(PASSWORD_VIEW_MODES),
  duration_hours: z.number().int().min(1).max(24 * 365).optional(),
});

export const GET = withDashboardSuperAdmin(async (_req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const service = new SuperadminPasswordViewService(requestId);
    const preference = await service.getPreference(user.id);
    const activeGrant = await service.getActiveGrant(user.id);

    return NextResponse.json({
      success: true,
      data: {
        preference,
        active_grant: activeGrant
          ? {
              grant_id: Number(activeGrant.grant_id),
              mode: activeGrant.mode,
              duration_hours: activeGrant.duration_hours,
              expires_at: activeGrant.expires_at?.toISOString() ?? null,
              one_time_consumed: activeGrant.one_time_consumed,
            }
          : null,
        duration_presets: [
          { id: "1h", label: "1 hour", hours: 1 },
          { id: "24h", label: "24 hours", hours: 24 },
          { id: "7d", label: "7 days", hours: 24 * 7 },
          { id: "30d", label: "30 days", hours: 24 * 30 },
        ],
      },
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
      "Failed to load password view preference",
    );
  }
});

export const PUT = withDashboardSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const body = await req.json().catch(() => null);
    const parsed = preferenceSchema.safeParse(body);
    if (!parsed.success) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        "Invalid password view preference payload.",
        400,
        requestId,
        { issues: parsed.error.issues },
      );
    }

    const service = new SuperadminPasswordViewService(requestId);
    const preference = await service.updatePreference(user.id, {
      mode: parsed.data.mode,
      duration_hours: parsed.data.duration_hours ?? 24,
    });

    return NextResponse.json({
      success: true,
      data: { preference },
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
      "Failed to update password view preference",
    );
  }
});

export const DELETE = withDashboardSuperAdmin(async (_req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const service = new SuperadminPasswordViewService(requestId);
    const data = await service.revokeGrants(user.id);

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
      "Failed to revoke password view grants",
    );
  }
});
