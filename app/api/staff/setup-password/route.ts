import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireStaffPortal } from "@/lib/auth/staff-portal-middleware";
import { AuthErrorCode, createAuthError } from "@/lib/errors/auth-errors";
import { toAuthErrorNextResponse } from "@/lib/errors/auth-http";
import { AdminAuthService } from "@/lib/services/auth.service";
import { getClientIp, getUserAgent } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";

const setupPasswordSchema = z.object({
  new_password: z.string().min(1).max(256),
  confirm_password: z.string().min(1).max(256),
});

export async function POST(req: NextRequest): Promise<Response> {
  const startedAt = Date.now();

  try {
    const context = await requireStaffPortal(req);
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    const body = await req.json().catch(() => null);
    const parsed = setupPasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw createAuthError(
        AuthErrorCode.INVALID_REQUEST_PAYLOAD,
        "Invalid setup-password payload",
        400,
        context.requestId,
        { issues: parsed.error.issues }
      );
    }

    const credential = await prisma.credential.findUnique({
      where: { user_id: context.staffId },
      select: { must_change_password: true },
    });

    if (!credential?.must_change_password) {
      throw createAuthError(
        AuthErrorCode.INVALID_REQUEST_PAYLOAD,
        "Password setup is not required for this account",
        400,
        context.requestId
      );
    }

    const service = new AdminAuthService(context.requestId);
    const data = await service.setInitialStaffPassword(
      {
        newPassword: parsed.data.new_password,
        confirmPassword: parsed.data.confirm_password,
      },
      {
        userId: context.user.id,
        email: context.user.email,
        role: context.user.role,
        rememberMe: false,
      },
      {
        ipAddress: ip,
        userAgent,
      }
    );

    return NextResponse.json({
      success: true,
      data,
      meta: {
        requestId: context.requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    const requestId = req.headers.get("x-request-id") ?? "staff-setup-password";
    return toAuthErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to set staff password"
    );
  }
}
