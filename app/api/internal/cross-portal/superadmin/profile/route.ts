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

const PROFILE_PATH = "/api/internal/cross-portal/superadmin/profile";

const profileUpdateSchema = z.object({
  email: z.string().trim().email().max(255),
  first_name: z.string().trim().min(1).max(100).optional(),
  last_name: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().max(20).optional(),
  location: z.string().trim().max(255).optional(),
  profile_image: z.string().trim().max(1024).optional(),
  cover_image: z.string().trim().max(1024).optional(),
});

async function resolveSuperadminByEmail(email: string, requestId: string) {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { user_id: true, role: true, email: true },
  });

  if (!user) {
    throw createSettingsError(
      SettingsErrorCode.PROFILE_NOT_FOUND,
      "Superadmin profile not found",
      404,
      requestId,
      { email: normalized },
    );
  }

  const role = String(user.role).trim().toLowerCase();
  if (role !== "super_admin" && role !== "dev") {
    throw createSettingsError(
      SettingsErrorCode.UNAUTHORIZED_ACCESS,
      "Target account is not a superadmin",
      403,
      requestId,
      { role },
    );
  }

  return { userId: Number(user.user_id), email: user.email };
}

function authFailureResponse(code: string, requestId: string) {
  const status = code === "CROSS_PORTAL_AUTH_REPLAY" ? 409 : 401;
  return NextResponse.json(
    {
      success: false,
      error: {
        code: "CROSS_PORTAL_AUTH_FAILED",
        message: "Cross-portal service authentication failed.",
      },
      meta: { requestId, timestamp: new Date().toISOString() },
    },
    { status },
  );
}

function ensureConfigured(requestId: string) {
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
  return null;
}

function verifyOrRespond(input: {
  method: string;
  path: string;
  bodyText: string;
  headers: Headers;
  requestId: string;
}) {
  try {
    verifyCrossPortalServiceRequest(input);
    return null;
  } catch (error) {
    const code = error instanceof Error ? error.message : "CROSS_PORTAL_AUTH_INVALID";
    return authFailureResponse(code, input.requestId);
  }
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  try {
    const unavailable = ensureConfigured(requestId);
    if (unavailable) return unavailable;

    const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase() ?? "";
    if (!email || !email.includes("@")) {
      throw createSettingsError(
        SettingsErrorCode.INVALID_REQUEST_PAYLOAD,
        "email query parameter is required",
        400,
        requestId,
      );
    }

    const signedPath = `${PROFILE_PATH}?email=${encodeURIComponent(email)}`;
    const authError = verifyOrRespond({
      method: "GET",
      path: signedPath,
      bodyText: "",
      headers: req.headers,
      requestId,
    });
    if (authError) return authError;

    const target = await resolveSuperadminByEmail(email, requestId);
    const service = new SuperadminSettingsService(requestId);
    const data = await service.getProfile(target.userId);

    await logAuditEvent(
      "CROSS_PORTAL_SUPERADMIN_PROFILE_READ",
      target.userId,
      undefined,
      undefined,
      { requestId, caller: "smartpet-admin" },
    );

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
      "Failed to load cross-portal superadmin profile",
    );
  }
}

export async function PUT(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  try {
    const unavailable = ensureConfigured(requestId);
    if (unavailable) return unavailable;

    const bodyText = await req.text();
    const authError = verifyOrRespond({
      method: "PUT",
      path: PROFILE_PATH,
      bodyText,
      headers: req.headers,
      requestId,
    });
    if (authError) return authError;

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

    const parsed = profileUpdateSchema.safeParse(json);
    if (!parsed.success) {
      throw createSettingsError(
        SettingsErrorCode.INVALID_REQUEST_PAYLOAD,
        "Invalid profile update payload",
        400,
        requestId,
        { issues: parsed.error.issues },
      );
    }

    const target = await resolveSuperadminByEmail(parsed.data.email, requestId);
    const service = new SuperadminSettingsService(requestId);
    const { email: _identityEmail, ...updates } = parsed.data;
    const data = await service.updateProfile(target.userId, updates);

    await logAuditEvent(
      "CROSS_PORTAL_SUPERADMIN_PROFILE_UPDATED",
      target.userId,
      undefined,
      undefined,
      {
        requestId,
        caller: "smartpet-admin",
        updatedFields: Object.keys(updates),
      },
    );

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
      "Failed to update cross-portal superadmin profile",
    );
  }
}
