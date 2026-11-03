import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, getUserAgent, resolveRequestSession } from "@/server/lib/auth";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { actorUserIdFromSession, ensureCompanyPermission,
  ensureCompanyRole,
  ensurePrimaryAdmin,
  logCompanyAudit,
  resolveCompanyActorContext,
  syncAllMemberBizcardsToCompanyTheme, } from "@/server/lib/company";
import {
  assertThemeAllowedForTier,
  getCompanyThemeContext,
  getPrimaryAdminSubscriptionTier,
} from "@/server/lib/company-themes";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";
import { invalidateCachePattern } from "@/lib/cache/invalidation";
import { generateCacheKey } from "@/lib/cache";
import { isHitachiCompanyId, resolveHitachiCompanyIds } from "@/lib/constants/hitachi-companies";

function parseThemeBody(input: unknown, requestId: string): { company_theme: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createCompanyError(CompanyErrorCode.INVALID_COMPANY_THEME, "Body must be a JSON object.", 400, requestId);
  }

  const payload = input as Record<string, unknown>;
  const themeRaw = payload.company_theme;
  const theme = typeof themeRaw === "string" ? themeRaw.trim() : "";

  if (!theme) {
    throw createCompanyError(CompanyErrorCode.INVALID_COMPANY_THEME, "company_theme is required.", 400, requestId);
  }

  if (theme.length > 100) {
    throw createCompanyError(
      CompanyErrorCode.INVALID_COMPANY_THEME,
      "company_theme must be at most 100 characters.",
      422,
      requestId,
    );
  }

  return { company_theme: theme };
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rl = checkRateLimit("company-theme-update", ip);
    if (!rl.allowed) {
      throw createCompanyError(
        CompanyErrorCode.RATE_LIMIT_EXCEEDED,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) },
      );
    }

    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      throw createCompanyError(CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION, "Authentication required.", 401, requestId);
    }

    const context = await resolveCompanyActorContext({
      userId: actorUserIdFromSession(auth),
      requestId,
    });
    ensureCompanyRole(context, ["admin", "manager"], requestId);
    ensureCompanyPermission(context, "edit_company", requestId);

    const data = await getCompanyThemeContext(context.companyId);

    return jsonSuccess(data, { requestId, responseTime: Date.now() - startedAt });
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/theme GET] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}

export async function PUT(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  try {
    const rl = checkRateLimit("company-theme-update", ip);
    if (!rl.allowed) {
      throw createCompanyError(
        CompanyErrorCode.RATE_LIMIT_EXCEEDED,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) },
      );
    }

    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      throw createCompanyError(CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION, "Authentication required.", 401, requestId);
    }

    const context = await resolveCompanyActorContext({
      userId: actorUserIdFromSession(auth),
      requestId,
    });
    ensureCompanyRole(context, ["admin", "manager"], requestId);
    ensureCompanyPermission(context, "edit_company", requestId);
    ensurePrimaryAdmin(context, requestId);

    let body: { company_theme: string };
    try {
      body = parseThemeBody(await request.json(), requestId);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw createCompanyError(CompanyErrorCode.INVALID_COMPANY_THEME, "Invalid JSON body.", 400, requestId);
    }

    const tier = await getPrimaryAdminSubscriptionTier(context.companyId);
    await resolveHitachiCompanyIds(prisma);
    const resolvedTheme = assertThemeAllowedForTier(
      body.company_theme,
      tier,
      requestId,
      isHitachiCompanyId(context.companyId),
    );

    const { updated, bizcardsUpdated } = await prisma.$transaction(async (tx) => {
      const row = await tx.company.update({
        where: { company_id: context.companyId },
        data: { company_theme: resolvedTheme },
        select: {
          company_id: true,
          company_theme: true,
        },
      });

      const count = await syncAllMemberBizcardsToCompanyTheme(tx, context.companyId, resolvedTheme);
      return { updated: row, bizcardsUpdated: count };
    });

    await invalidateCachePattern(generateCacheKey("public", "profile", "*"));

    await logCompanyAudit({
      companyId: context.companyId,
      userId: context.userId,
      action: "company.theme.updated",
      requestId,
      ipAddress: ip,
      userAgent,
      details: {
        company_theme: resolvedTheme,
        bizcards_updated: bizcardsUpdated,
      },
    });

    return jsonSuccess(
      {
        success: true,
        company_id: updated.company_id.toString(),
        company_theme: updated.company_theme,
        bizcards_updated: bizcardsUpdated,
        scope: "company-default-and-member-sync",
      },
      { requestId, responseTime: Date.now() - startedAt },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/theme PUT] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
