import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth, type AdminAuthContext } from "@/lib/auth/admin-auth-middleware";
import { AuthErrorCode, createAuthError, toAuthErrorResponse } from "@/lib/errors/auth-errors";
import { toAuthErrorNextResponse } from "@/lib/errors/auth-http";
import { checkAdminAuthRateLimit } from "@/lib/rate-limit/auth-admin-limits";
import { AdminAuthService } from "@/lib/services/auth.service";
import { getClientIp, getUserAgent } from "@/server/lib/auth";

const changePasswordSchema = z.object({
  current_password: z.string().min(1).max(256),
  new_password: z.string().min(1).max(256),
  confirm_password: z.string().min(1).max(256),
});

const postHandler = withAdminAuth(async (req: NextRequest, context: AdminAuthContext) => {
  const startedAt = Date.now();
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const rateLimit = checkAdminAuthRateLimit(req, "CHANGE_PASSWORD", String(context.user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toAuthErrorResponse(
          AuthErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many password change attempts. Please try again later.",
          context.requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfter ?? 1),
          },
        }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw createAuthError(
        AuthErrorCode.INVALID_REQUEST_PAYLOAD,
        "Invalid change-password payload",
        400,
        context.requestId,
        { issues: parsed.error.issues }
      );
    }

    const service = new AdminAuthService(context.requestId);
    const data = await service.changePassword(
      {
        currentPassword: parsed.data.current_password,
        newPassword: parsed.data.new_password,
        confirmPassword: parsed.data.confirm_password,
      },
      {
        userId: context.user.id,
        email: context.user.email,
        role: context.user.role,
        rememberMe: context.session.rememberMe,
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
    return toAuthErrorNextResponse(
      error,
      context.requestId,
      Date.now() - startedAt,
      "Failed to change admin password"
    );
  }
});

export async function POST(
  req: NextRequest,
  context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }
): Promise<Response> {
  return postHandler(req, context);
}
