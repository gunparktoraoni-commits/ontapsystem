import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { ThemeService } from "@/lib/services/theme.service";
import { AppError, ErrorCode, createUnauthorizedError, createValidationError } from "@/lib/errors/types";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();

  try {
    const resolved = await resolveRequestSession(request, { tryRefresh: true });
    if (!resolved.session) {
      throw createUnauthorizedError("Authentication required", requestId);
    }

    const ip = getClientIp(request);
    const rate = checkRateLimit("analytics-dashboard", `${ip}:${resolved.session.userId}`);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: ErrorCode.RATE_LIMIT_EXCEEDED,
            message: "Too many requests. Please try again later.",
            retryAfter: Math.ceil(rate.retryAfterMs / 1000),
            requestId,
          },
          meta: { requestId, responseTime: Date.now() - startedAt },
        },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
      );
    }

    const actor = await prisma.user.findUnique({
      where: { user_id: BigInt(resolved.session.userId) },
      select: { role: true },
    });

    if (!actor || (actor.role !== "admin" && actor.role !== "super_admin")) {
      throw new AppError(
        ErrorCode.INSUFFICIENT_PERMISSIONS,
        "Admin access required",
        403,
        { role: actor?.role ?? null },
        requestId
      );
    }

    const url = new URL(request.url);
    const rawThemeId = url.searchParams.get("themeId");
    const themeId = rawThemeId === null ? undefined : Number.parseInt(rawThemeId, 10);

    if (rawThemeId !== null && (!Number.isInteger(themeId) || (themeId ?? 0) <= 0)) {
      throw createValidationError("themeId", "must be a positive integer", requestId);
    }

    const service = new ThemeService(requestId);
    const analytics = await service.getThemeAnalytics(themeId);

    return jsonSuccess(analytics, {
      requestId,
      responseTime: Date.now() - startedAt,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/admin/themes/analytics GET] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
