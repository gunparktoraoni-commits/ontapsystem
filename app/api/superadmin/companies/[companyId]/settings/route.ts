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

type RouteContext = SuperAdminCompanyContext & {
  params: Promise<{ companyId: string }>;
};

type CompanySettingsInput = {
  settings: Record<string, unknown>;
  approval_required?: boolean;
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

function validateInput(input: unknown, requestId: string): CompanySettingsInput {
  if (!input || typeof input !== "object") {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "Body must be a JSON object.",
      400,
      requestId
    );
  }

  const payload = input as Record<string, unknown>;
  const settingsRaw = payload.settings;
  if (!settingsRaw || typeof settingsRaw !== "object" || Array.isArray(settingsRaw)) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "settings must be an object.",
      400,
      requestId
    );
  }

  const approvalRequired = payload.approval_required;
  if (approvalRequired !== undefined && typeof approvalRequired !== "boolean") {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "approval_required must be boolean when provided.",
      400,
      requestId
    );
  }

  return {
    settings: settingsRaw as Record<string, unknown>,
    approval_required: approvalRequired as boolean | undefined,
  };
}

export const PUT = withCompanySuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, originalUser, effectiveUser, impersonation } = context;

  try {
    const rateLimit = checkSuperadminCompanyRateLimit(req, "SETTINGS_UPDATE", String(originalUser.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many company settings update requests. Please try again later.",
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

    let input: CompanySettingsInput;
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

    const updated = await prisma.company.update({
      where: { company_id: parsedCompanyId },
      data: {
        settings: JSON.stringify(input.settings),
        ...(input.approval_required !== undefined ? { approval_required: input.approval_required } : {}),
      },
      select: {
        company_id: true,
        name: true,
        settings: true,
        approval_required: true,
      },
    });

    await logCompanyAudit({
      companyId: updated.company_id,
      userId: originalUser.userId,
      action: "superadmin.company.settings.updated",
      requestId,
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
      details: {
        approval_required: updated.approval_required,
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
        approval_required: updated.approval_required,
        settings: updated.settings ? JSON.parse(updated.settings) : {},
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
      "Failed to update company settings"
    );
  }
});
