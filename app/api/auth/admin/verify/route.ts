import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth, type AdminAuthContext } from "@/lib/auth/admin-auth-middleware";
import { AuthErrorCode, toAuthErrorResponse } from "@/lib/errors/auth-errors";
import { toAuthErrorNextResponse } from "@/lib/errors/auth-http";
import { checkAdminAuthRateLimit } from "@/lib/rate-limit/auth-admin-limits";
import { AdminAuthService } from "@/lib/services/auth.service";

const getHandler = withAdminAuth(async (req: NextRequest, context: AdminAuthContext) => {
  const startedAt = Date.now();

  try {
    const rateLimit = checkAdminAuthRateLimit(req, "VERIFY", String(context.user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toAuthErrorResponse(
          AuthErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many verify requests. Please try again later.",
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

    const service = new AdminAuthService(context.requestId);
    const user = await service.verify(context.user.id);

    return NextResponse.json({
      success: true,
      data: {
        user,
        session: {
          sessionId: context.session.sessionId,
          rememberMe: context.session.rememberMe,
          expiresAt: context.session.expiresAt.toISOString(),
          refreshed: context.session.refreshed,
        },
      },
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
      "Failed to verify admin session"
    );
  }
});

export async function GET(
  req: NextRequest,
  context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }
): Promise<Response> {
  return getHandler(req, context);
}
