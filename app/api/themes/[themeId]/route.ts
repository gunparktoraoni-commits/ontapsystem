import { NextRequest, NextResponse } from "next/server";
import { ThemeService } from "@/lib/services/theme.service";
import { AppError, ErrorCode, createNotFoundError, createValidationError } from "@/lib/errors/types";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { prisma } from "@/server/lib/prisma";
import { resolveCompanyThemePolicyForUser } from "@/server/lib/company";
import { resolveHitachiCompanyIds } from "@/lib/constants/hitachi-companies";
import { buildThemeVisibilityOrFilters } from "@/lib/services/theme-visibility.service";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ themeId: string }> }
): Promise<NextResponse> {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();

  try {
    const ip = getClientIp(request);
    const rate = checkRateLimit("bizcard-themes-list", ip);
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

    const { themeId: rawThemeId } = await context.params;
    const themeId = Number.parseInt(rawThemeId, 10);
    if (!Number.isInteger(themeId) || themeId <= 0) {
      throw createValidationError("themeId", "must be a positive integer", requestId);
    }

    const resolved = await resolveRequestSession(request, { tryRefresh: true });
    const userId = resolved.session?.userId ? BigInt(resolved.session.userId) : null;
    let companyId: bigint | null = null;
    if (userId !== null) {
      await resolveHitachiCompanyIds(prisma);
      const companyPolicy = await resolveCompanyThemePolicyForUser(userId);
      companyId = companyPolicy.companyId ? BigInt(companyPolicy.companyId) : null;
    }
    const visibilityFilters = buildThemeVisibilityOrFilters({ userId, companyId });
    const accessibleTheme = await prisma.theme.findFirst({
      where: {
        id: BigInt(themeId),
        is_active: true,
        OR: visibilityFilters,
      },
      select: { id: true },
    });
    if (!accessibleTheme) {
      throw createNotFoundError("Theme", themeId, requestId);
    }

    const service = new ThemeService(requestId);
    const theme = await service.getThemeById(themeId);
    for (const colorWay of theme.color_ways) {
      void service.trackThemeView(theme.theme_id, colorWay.color_way_id);
    }

    return jsonSuccess(theme, {
      requestId,
      responseTime: Date.now() - startedAt,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/themes/:themeId GET] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
