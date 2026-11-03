import { NextRequest, NextResponse } from "next/server";
import { getRequestId } from "@/lib/errors/http";
import { AuthErrorCode, toAuthErrorResponse } from "@/lib/errors/auth-errors";
import { toAuthErrorNextResponse } from "@/lib/errors/auth-http";
import { checkAdminAuthRateLimit } from "@/lib/rate-limit/auth-admin-limits";
import { AdminAuthService } from "@/lib/services/auth.service";
import { getClientIp, getUserAgent } from "@/server/lib/auth";
import { extractGeoMetadata } from "@/server/lib/analytics";

export async function POST(req: NextRequest): Promise<Response> {
  const startedAt = Date.now();
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);
  const geo = extractGeoMetadata(req);
  const location = geo.city && geo.country ? `${geo.city}, ${geo.country}` : geo.country ?? null;

  try {
    const rateLimit = checkAdminAuthRateLimit(req, "REFRESH_TOKEN");
    if (!rateLimit.success) {
      return NextResponse.json(
        toAuthErrorResponse(
          AuthErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many admin refresh attempts. Please try again later.",
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
    const data = await service.refresh({
      ipAddress: ip,
      userAgent,
      location,
      latitude: geo.latitude,
      longitude: geo.longitude,
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
      "Failed to refresh admin session"
    );
  }
}
