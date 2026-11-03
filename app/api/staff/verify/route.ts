import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRequestId } from "@/lib/errors/http";
import { AuthErrorCode, createAuthError } from "@/lib/errors/auth-errors";
import { toAuthErrorNextResponse } from "@/lib/errors/auth-http";
import { AdminAuthService } from "@/lib/services/auth.service";
import { getClientIp, getUserAgent } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

const completeSchema = z.object({
  token: z.string().trim().min(16).max(256),
  new_password: z.string().min(1).max(256),
  confirm_password: z.string().min(1).max(256),
});

export async function GET(req: NextRequest): Promise<Response> {
  const startedAt = Date.now();
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req);

  try {
    const rateCheck = checkRateLimit("staff-invite-verify", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    const token = req.nextUrl.searchParams.get("token")?.trim() ?? "";
    const service = new AdminAuthService(requestId);
    const result = await service.verifyStaffInviteToken(token);

    return NextResponse.json({
      success: result.valid,
      data: result.valid
        ? {
            email: result.email,
            firstName: result.firstName,
            lastName: result.lastName,
          }
        : null,
      error: result.valid ? null : { message: result.reason ?? "Invalid verification link." },
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
      "Failed to validate staff verification link"
    );
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const startedAt = Date.now();
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const rateCheck = checkRateLimit("staff-invite-complete", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = completeSchema.safeParse(body);
    if (!parsed.success) {
      throw createAuthError(
        AuthErrorCode.INVALID_REQUEST_PAYLOAD,
        "Invalid staff verification payload",
        400,
        requestId,
        { issues: parsed.error.issues }
      );
    }

    const service = new AdminAuthService(requestId);
    const data = await service.completeStaffInviteVerification(
      parsed.data.token,
      parsed.data.new_password,
      parsed.data.confirm_password,
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
      "Failed to complete staff account verification"
    );
  }
}
