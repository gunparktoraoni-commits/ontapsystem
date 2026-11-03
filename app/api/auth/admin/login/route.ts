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
import { extractGeoMetadata } from "@/server/lib/analytics";
import { resolveLoginGeoFromIp } from "@/lib/services/geolocation.service";
import { checkDistributedRateLimit } from "@/server/lib/rate-limit-distributed";

const loginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(256),
  rememberMe: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest): Promise<Response> {
  const startedAt = Date.now();
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);
  const geo = extractGeoMetadata(req);
  const headerLocation = geo.city && geo.country ? `${geo.city}, ${geo.country}` : geo.country ?? null;
  const resolvedGeo = await resolveLoginGeoFromIp(ip, {
    location: headerLocation,
    latitude: geo.latitude,
    longitude: geo.longitude,
  });

  try {
    const distributed = await checkDistributedRateLimit(ip, "login");
    if (!distributed.allowed) {
      return NextResponse.json(
        toAuthErrorResponse(
          AuthErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many login attempts. Please try again later.",
          requestId,
          {
            retryAfter: Math.max(1, Math.ceil(distributed.retryAfterMs / 1000)),
            remaining: 0,
            scope: "distributed",
          },
          Date.now() - startedAt
        ),
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.max(1, Math.ceil(distributed.retryAfterMs / 1000))),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    const rateLimit = checkAdminAuthRateLimit(req, "LOGIN");
    if (!rateLimit.success) {
      return NextResponse.json(
        toAuthErrorResponse(
          AuthErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many admin login attempts. Please try again later.",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfter ?? 1),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw createAuthError(
        AuthErrorCode.INVALID_REQUEST_PAYLOAD,
        "Invalid admin login payload",
        400,
        requestId,
        { issues: parsed.error.issues }
      );
    }

    const service = new AdminAuthService(requestId);
    const data = await service.login(parsed.data, {
      ipAddress: ip,
      userAgent,
      location: resolvedGeo.location,
      latitude: resolvedGeo.latitude,
      longitude: resolvedGeo.longitude,
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
      "Failed to complete admin login"
    );
  }
}
