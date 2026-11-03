import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, getUserAgent, resolveRequestSession } from "@/server/lib/auth";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { actorUserIdFromSession, ensureCompanyPermission,
  ensureCompanyRole,
  logCompanyAudit,
  parseCompanySettings,
  resolveCompanyActorContext, } from "@/server/lib/company";
import { notifyCompanyAdmins } from "@/server/lib/company-notifications";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";
import { validateCompanySettingsUpdateInput } from "@/server/lib/validators";

function readProfileString(settings: Record<string, unknown>, key: string): string | null {
  const value = settings[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function PUT(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  try {
    const rl = checkRateLimit("company-settings-update", ip);
    if (!rl.allowed) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) }
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

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      throw createCompanyError(CompanyErrorCode.COMPANY_NOT_FOUND, "Invalid JSON body.", 400, requestId);
    }

    const validation = validateCompanySettingsUpdateInput(body);
    if (!validation.valid) {
      throw createCompanyError(
        CompanyErrorCode.COMPANY_NOT_FOUND,
        validation.errors[0] ?? "Validation failed.",
        400,
        requestId,
        { errors: validation.errors }
      );
    }

    const input = validation.data;

    const existing = await prisma.company.findUnique({
      where: { company_id: context.companyId },
      select: {
        company_id: true,
        email: true,
        settings: true,
      },
    });

    if (!existing) {
      throw createCompanyError(CompanyErrorCode.COMPANY_NOT_FOUND, "Company not found.", 404, requestId);
    }

    if (input.email !== undefined && input.email !== existing.email) {
      if (input.email) {
        const emailInUse = await prisma.company.findFirst({
          where: {
            email: input.email,
            company_id: { not: context.companyId },
          },
          select: { company_id: true },
        });

        if (emailInUse) {
          throw createCompanyError(
            CompanyErrorCode.COMPANY_ALREADY_EXISTS,
            "Company email is already in use.",
            409,
            requestId
          );
        }
      }
    }

    const existingSettings = parseCompanySettings(existing.settings);
    const profileSettingsPatch: Record<string, unknown> = {};

    if (input.industry !== undefined) {
      if (input.industry === null) {
        delete existingSettings.industry;
      } else {
        profileSettingsPatch.industry = input.industry;
      }
    }

    if (input.phone !== undefined) {
      if (input.phone === null) {
        delete existingSettings.phone;
      } else {
        profileSettingsPatch.phone = input.phone;
      }
    }

    if (input.address !== undefined) {
      if (input.address === null) {
        delete existingSettings.address;
      } else {
        profileSettingsPatch.address = input.address;
      }
    }

    const mergedSettings = { ...existingSettings, ...profileSettingsPatch };
    if (input.industry === null) delete mergedSettings.industry;
    if (input.phone === null) delete mergedSettings.phone;
    if (input.address === null) delete mergedSettings.address;

    const updated = await prisma.company.update({
      where: { company_id: context.companyId },
      data: {
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.logo_url !== undefined ? { logo_url: input.logo_url } : {}),
        settings: JSON.stringify(mergedSettings),
        ...(input.approval_required !== undefined ? { approval_required: input.approval_required } : {}),
        ...(input.is_public !== undefined ? { is_public: input.is_public } : {}),
        updated_at: new Date(),
      },
      select: {
        company_id: true,
        description: true,
        email: true,
        logo_url: true,
        settings: true,
        approval_required: true,
        is_public: true,
      },
    });

    const parsedSettings = parseCompanySettings(updated.settings);

    await logCompanyAudit({
      companyId: context.companyId,
      userId: context.userId,
      action: "company.settings.updated",
      requestId,
      ipAddress: ip,
      userAgent,
      details: {
        approval_required: updated.approval_required,
        is_public: updated.is_public,
        description_updated: input.description !== undefined,
        email_updated: input.email !== undefined,
        logo_url_updated: input.logo_url !== undefined,
        industry_updated: input.industry !== undefined,
        phone_updated: input.phone !== undefined,
        address_updated: input.address !== undefined,
      },
    });

    await notifyCompanyAdmins(context.companyId, "company_details_changed_enabled", {
      title: "Company details updated",
      message: "Company profile or governance settings were updated.",
      metadata: {
        company_id: context.companyId.toString(),
        updated_by: context.userId.toString(),
      },
      actionUrl: "/admin/company",
      actionText: "View company",
    });

    return jsonSuccess(
      {
        success: true,
        company_id: updated.company_id.toString(),
        description: updated.description,
        email: updated.email,
        logo_url: updated.logo_url,
        industry: readProfileString(parsedSettings, "industry"),
        phone: readProfileString(parsedSettings, "phone"),
        address: readProfileString(parsedSettings, "address"),
        approval_required: updated.approval_required,
        is_public: updated.is_public,
      },
      { requestId, responseTime: Date.now() - startedAt }
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/settings PUT] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
