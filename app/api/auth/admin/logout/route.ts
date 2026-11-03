import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth, type AdminAuthContext } from "@/lib/auth/admin-auth-middleware";
import { AuthErrorCode, toAuthErrorResponse } from "@/lib/errors/auth-errors";
import { toAuthErrorNextResponse } from "@/lib/errors/auth-http";
import { checkAdminAuthRateLimit } from "@/lib/rate-limit/auth-admin-limits";
import { AdminAuthService } from "@/lib/services/auth.service";
import { getClientIp, getUserAgent } from "@/server/lib/auth";
import { extractGeoMetadata } from "@/server/lib/analytics";

const postHandler = withAdminAuth(async (req: NextRequest, context: AdminAuthContext) => {
  const startedAt = Date.now();
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);
  const geo = extractGeoMetadata(req);
  const location = geo.city && geo.country ? `${geo.city}, ${geo.country}` : geo.country ?? null;

  try {
    const rateLimit = checkAdminAuthRateLimit(req, "LOGOUT", String(context.user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toAuthErrorResponse(
          AuthErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many logout requests. Please try again later.",
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
    await service.logout(
      {
        userId: context.user.id,
        email: context.user.email,
        role: context.user.role,
        rememberMe: context.session.rememberMe,
        sessionId: context.session.sessionId,
      },
      {
        ipAddress: ip,
        userAgent,
        location,
        latitude: geo.latitude,
        longitude: geo.longitude,
      }
    );

    return NextResponse.json({
      success: true,
      data: {
        message: "Admin session logged out successfully.",
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
      "Failed to logout admin session"
    );
  }
});

export async function POST(
  req: NextRequest,
  context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }
): Promise<Response> {
  return postHandler(req, context);
}
