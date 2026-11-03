import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  SuperAdminErrorCode,
  createSuperAdminError,
} from "@/lib/errors/superadmin-errors";
import { toSuperAdminErrorNextResponse } from "@/lib/errors/superadmin-http";
import { getClientIp, getUserAgent } from "@/server/lib/auth";
import { SuperadminPasswordViewService } from "@/lib/services/superadmin-password-view.service";

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

const changePasswordSchema = z.object({
  superadmin_password: z.string().min(1).max(128),
  new_password: z.string().min(8).max(128),
  confirm_password: z.string().min(8).max(128),
  must_change_password: z.boolean().optional(),
});

export const GET = withDashboardSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const params = await (context as typeof context & RouteContext).params;
    const targetUserId = parseUserId(params.userId, requestId);
    const service = new SuperadminPasswordViewService(requestId);
    const data = await service.getPasswordStatus(user.id, targetUserId);

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
      "Failed to load password status",
    );
  }
});

export const PUT = withDashboardSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const params = await (context as typeof context & RouteContext).params;
    const targetUserId = parseUserId(params.userId, requestId);
    const body = await req.json().catch(() => null);
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        "Invalid password change payload.",
        400,
        requestId,
        { issues: parsed.error.issues },
      );
    }

    const service = new SuperadminPasswordViewService(requestId);
    const data = await service.changeUserPassword({
      superadminUserId: user.id,
      targetUserId,
      superadminPassword: parsed.data.superadmin_password,
      newPassword: parsed.data.new_password,
      confirmPassword: parsed.data.confirm_password,
      mustChangePassword: parsed.data.must_change_password,
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
      "Failed to change user password",
    );
  }
});
