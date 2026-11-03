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

const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(255),
});

export async function POST(req: NextRequest): Promise<Response> {
  const startedAt = Date.now();
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const body = await req.json().catch(() => null);
    const parsed = forgotPasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw createAuthError(
        AuthErrorCode.INVALID_REQUEST_PAYLOAD,
        "Invalid forgot-password payload",
        400,
        requestId,
        { issues: parsed.error.issues }
      );
    }

    const rateLimit = checkAdminAuthRateLimit(req, "FORGOT_PASSWORD", parsed.data.email.toLowerCase());
    if (!rateLimit.success) {
      return NextResponse.json(
        toAuthErrorResponse(
          AuthErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many forgot-password requests. Please try again later.",
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

    const service = new AdminAuthService(requestId);
    const data = await service.forgotPassword(parsed.data.email, {
      ipAddress: ip,
      userAgent,
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
    return toAuthErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to process admin forgot-password request"
    );
  }
}
