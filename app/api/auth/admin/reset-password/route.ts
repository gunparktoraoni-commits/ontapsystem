import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRequestId } from "@/lib/errors/http";
import {
  AuthErrorCode,
  createAuthError,
  toAuthErrorResponse,
} from "@/lib/errors/auth-errors";
import { toAuthErrorNextResponse } from "@/lib/errors/auth-http";
import { checkAdminAuthRateLimit } from "@/lib/rate-limit/auth-admin-limits";
import { AdminAuthService } from "@/lib/services/auth.service";
import { getClientIp, getUserAgent } from "@/server/lib/auth";

const resetPasswordSchema = z.object({
  token: z.string().trim().min(1).max(256),
  new_password: z.string().min(1).max(256),
  confirm_password: z.string().min(1).max(256),
});

export async function POST(req: NextRequest): Promise<Response> {
  const startedAt = Date.now();
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const rateLimit = checkAdminAuthRateLimit(req, "RESET_PASSWORD");
    if (!rateLimit.success) {
      return NextResponse.json(
        toAuthErrorResponse(
          AuthErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many reset-password attempts. Please try again later.",
          requestId,
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
    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw createAuthError(
        AuthErrorCode.INVALID_REQUEST_PAYLOAD,
        "Invalid reset-password payload",
        400,
        requestId,
        { issues: parsed.error.issues }
      );
    }

    const service = new AdminAuthService(requestId);
    const data = await service.resetPassword(
      {
        token: parsed.data.token,
        newPassword: parsed.data.new_password,
        confirmPassword: parsed.data.confirm_password,
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
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return toAuthErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to reset admin password"
    );
  }
}
