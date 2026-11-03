import { NextRequest, NextResponse } from "next/server";
import { ThemeService } from "@/lib/services/theme.service";
import { subscriptionService } from "@/lib/services/subscription.service";
import { AppError, ErrorCode } from "@/lib/errors/types";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { prisma } from "@/server/lib/prisma";
import { resolveCompanyThemePolicyForUser } from "@/server/lib/company";
import { resolveHitachiCompanyIds } from "@/lib/constants/hitachi-companies";
import { buildThemeVisibilityOrFilters } from "@/lib/services/theme-visibility.service";

export async function GET(request: NextRequest): Promise<NextResponse> {
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

    const resolved = await resolveRequestSession(request, { tryRefresh: true });
    const userId = resolved.session?.userId;
    const sessionRole = String(resolved.session?.role ?? "").toLowerCase();
    const isPrivilegedPremium = sessionRole === "dev" || sessionRole === "super_admin";
    let companyId: bigint | null = null;
    if (userId) {
      await resolveHitachiCompanyIds(prisma);
      const companyPolicy = await resolveCompanyThemePolicyForUser(BigInt(userId));
      companyId = companyPolicy.companyId ? BigInt(companyPolicy.companyId) : null;
    }
    const visibilityFilters = buildThemeVisibilityOrFilters({
      userId: userId ? BigInt(userId) : null,
      companyId,
    });
    const subscriptionTier = userId
      ? (await subscriptionService.getSubscriptionStatus(BigInt(userId))).tier
      : "basic";

    const service = new ThemeService(requestId);
    const themes = await service.getAllThemes();
    const allowedThemeRows = await prisma.theme.findMany({
      where: { is_active: true, OR: visibilityFilters },
      select: { theme_path: true },
    });
    const allowedThemePaths = new Set(allowedThemeRows.map((theme) => theme.theme_path));
    const normalizedTier = String(subscriptionTier ?? "").toLowerCase();
    const tierRank: Record<string, number> = {
      basic: 1,
      standard: 2,
      premium: 3,
      enterprise: 3,
    };
    const userRank = isPrivilegedPremium ? Number.POSITIVE_INFINITY : (tierRank[normalizedTier] ?? 1);
    const filteredThemes = themes.filter((theme) => {
      if (!allowedThemePaths.has(theme.slug)) return false;
      const path = String(theme.slug ?? "").toLowerCase();
      if (path.startsWith("basic/")) return true;
      if (path.startsWith("standard/")) return userRank >= 2;
      if (path.startsWith("premium/")) return userRank >= 3;
      return true;
    });

    for (const theme of filteredThemes) {
      for (const colorWay of theme.color_ways) {
        void service.trackThemeView(theme.theme_id, colorWay.color_way_id);
      }
    }

    return jsonSuccess(filteredThemes, {
      requestId,
      responseTime: Date.now() - startedAt,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/themes GET] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
