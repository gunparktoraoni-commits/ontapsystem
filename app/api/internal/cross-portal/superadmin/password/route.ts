import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/server/lib/prisma";
import { logAuditEvent } from "@/server/lib/auth";
import {
  isCrossPortalServiceConfigured,
  verifyCrossPortalServiceRequest,
} from "@/server/lib/cross-portal-service-auth";
import { SuperadminSettingsService } from "@/lib/services/superadmin-settings.service";
import {
  SettingsErrorCode,
  createSettingsError,
} from "@/lib/errors/settings-errors";
import { toSettingsErrorNextResponse } from "@/lib/errors/settings-http";

export const runtime = "nodejs";

const PATH = "/api/internal/cross-portal/superadmin/password";

const changePasswordSchema = z
  .object({
    email: z.string().trim().email().max(255),
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

async function resolveSuperadminByEmail(email: string, requestId: string) {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { user_id: true, role: true },
  });

  if (!user) {
    throw createSettingsError(
      SettingsErrorCode.PROFILE_NOT_FOUND,
      "Superadmin profile not found",
      404,
      requestId,
    );
  }

  const role = String(user.role).trim().toLowerCase();
  if (role !== "super_admin" && role !== "dev") {
    throw createSettingsError(
      SettingsErrorCode.UNAUTHORIZED_ACCESS,
      "Target account is not a superadmin",
      403,
      requestId,
    );
  }

  return Number(user.user_id);
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  try {
    if (!isCrossPortalServiceConfigured()) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Cross-portal service is not configured.",
          },
          meta: { requestId, timestamp: new Date().toISOString() },
        },
        { status: 503 },
      );
    }

    const bodyText = await req.text();
    try {
      verifyCrossPortalServiceRequest({
        method: "POST",
        path: PATH,
        bodyText,
        headers: req.headers,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "CROSS_PORTAL_AUTH_INVALID";
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "CROSS_PORTAL_AUTH_FAILED",
            message: "Cross-portal service authentication failed.",
          },
          meta: { requestId, timestamp: new Date().toISOString() },
        },
        { status: code === "CROSS_PORTAL_AUTH_REPLAY" ? 409 : 401 },
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(bodyText || "{}") as unknown;
    } catch {
      throw createSettingsError(
        SettingsErrorCode.INVALID_REQUEST_PAYLOAD,
        "Invalid JSON body",
        400,
        requestId,
      );
    }

    const parsed = changePasswordSchema.safeParse(json);
    if (!parsed.success) {
      throw createSettingsError(
        SettingsErrorCode.INVALID_REQUEST_PAYLOAD,
        "Invalid change password payload",
        400,
        requestId,
        { issues: parsed.error.issues },
      );
    }

    const userId = await resolveSuperadminByEmail(parsed.data.email, requestId);
    const service = new SuperadminSettingsService(requestId);
    await service.changePassword(
      userId,
      parsed.data.current_password,
      parsed.data.new_password,
    );

    await logAuditEvent(
      "CROSS_PORTAL_SUPERADMIN_PASSWORD_CHANGED",
      userId,
      undefined,
      undefined,
      { requestId, caller: "smartpet-admin" },
    );

    return NextResponse.json({
      success: true,
      data: {
        message:
          "Password changed successfully on OnTap. Use this password on both portals.",
      },
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
      "Failed to change cross-portal superadmin password",
    );
  }
}
