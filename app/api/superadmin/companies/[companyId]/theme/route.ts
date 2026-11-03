import { NextRequest, NextResponse } from "next/server";
import { withCompanySuperAdmin, type SuperAdminCompanyContext } from "@/lib/auth/superadmin-middleware";
import {
  SuperAdminErrorCode,
  createSuperAdminError,
  toSuperAdminErrorResponse,
} from "@/lib/errors/superadmin-errors";
import { toSuperAdminErrorNextResponse } from "@/lib/errors/superadmin-http";
import { checkSuperadminCompanyRateLimit } from "@/lib/rate-limit/superadmin-company-limits";
import { prisma } from "@/server/lib/prisma";
import { getClientIp, getUserAgent } from "@/server/lib/auth";
import { logCompanyAudit } from "@/server/lib/company";
import { syncAllMemberBizcardsToCompanyTheme } from "@/server/lib/company";

type RouteContext = SuperAdminCompanyContext & {
  params: Promise<{ companyId: string }>;
};

type ThemeUpdateInput = {
  company_theme: string;
};

function parseCompanyId(raw: string, requestId: string): bigint {
  if (!/^\d+$/.test(raw)) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "Invalid companyId path parameter.",
      400,
      requestId,
      { companyId: raw }
    );
  }

  return BigInt(raw);
}

function validateInput(input: unknown, requestId: string): ThemeUpdateInput {
  if (!input || typeof input !== "object") {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "Body must be a JSON object.",
      400,
      requestId
    );
  }

  const payload = input as Record<string, unknown>;
  const theme = typeof payload.company_theme === "string" ? payload.company_theme.trim() : "";

  if (!theme) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "company_theme is required.",
      400,
      requestId
    );
  }

  if (theme.length > 100) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "company_theme must be at most 100 characters.",
      400,
      requestId
    );
  }

  return { company_theme: theme };
}

export const PUT = withCompanySuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, originalUser, effectiveUser, impersonation } = context;

  try {
    const rateLimit = checkSuperadminCompanyRateLimit(req, "THEME_UPDATE", String(originalUser.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many company theme update requests. Please try again later.",
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

    const { companyId } = await context.params;
    const parsedCompanyId = parseCompanyId(companyId, requestId);

    let input: ThemeUpdateInput;
    try {
      input = validateInput(await req.json(), requestId);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw createSuperAdminError(
          SuperAdminErrorCode.INVALID_FILTER,
          "Invalid JSON body.",
          400,
          requestId
        );
      }
      throw error;
    }

    const { updated, bizcardsUpdated } = await prisma.$transaction(async (tx) => {
      const row = await tx.company.update({
        where: { company_id: parsedCompanyId },
        data: {
          company_theme: input.company_theme,
        },
        select: {
          company_id: true,
          name: true,
          company_theme: true,
        },
      });

      const count = await syncAllMemberBizcardsToCompanyTheme(tx, parsedCompanyId, input.company_theme);
      return { updated: row, bizcardsUpdated: count };
    });

    await logCompanyAudit({
      companyId: updated.company_id,
      userId: originalUser.userId,
      action: "superadmin.company.theme.updated",
      requestId,
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
      details: {
        company_theme: input.company_theme,
        bizcards_updated: bizcardsUpdated,
        actor_context: {
          original_user_id: originalUser.userId.toString(),
          effective_user_id: effectiveUser.userId.toString(),
          impersonation_token_id: impersonation?.tokenId ?? null,
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        company_id: updated.company_id.toString(),
        company_name: updated.name,
        company_theme: updated.company_theme,
        bizcards_updated: bizcardsUpdated,
        scope: "company-default-and-member-sync",
      },
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return toSuperAdminErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to update company theme"
    );
  }
});
