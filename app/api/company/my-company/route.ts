import { NextRequest } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { prisma } from "@/server/lib/prisma";
import { AppError } from "@/lib/errors/types";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";
import { actorUserIdFromSession, resolveCompanyActorContext, parseCompanySettings, countCoAdmins, MAX_CO_ADMINS } from "@/server/lib/company";

function readProfileString(settings: Record<string, unknown>, key: string): string | null {
  const value = settings[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  const emptyCompanyResponse = () =>
    jsonSuccess(
      {
        has_company: false,
        company_id: null,
        company_name: null,
        company_slug: null,
        description: null,
        logo_url: null,
        email: null,
        industry: null,
        phone: null,
        address: null,
        pending_name_change: null,
        security_code: null,
        approval_required: null,
        is_public: null,
        company_theme: null,
        subscription_tier: null,
        max_employees: null,
        current_employees: null,
        status: null,
        my_role: null,
        joined_at: null,
        my_permissions: [],
      },
      { requestId, responseTime: Date.now() - startedAt }
    );

  try {
    const rl = checkRateLimit("company-my-company", ip);
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
      requireActiveMember: false,
    });

    const company = await prisma.company.findUnique({
      where: { company_id: context.companyId },
      select: {
        company_id: true,
        name: true,
        company_slug: true,
        description: true,
        email: true,
        logo_url: true,
        settings: true,
        pending_name_change: true,
        security_code: true,
        approval_required: true,
        is_public: true,
        company_theme: true,
        subscription_tier: true,
        max_employees: true,
        current_employees: true,
        status: true,
        admin_id: true,
        created_by: true,
      },
    });

    if (!company) {
      throw createCompanyError(CompanyErrorCode.COMPANY_NOT_FOUND, "Company not found.", 404, requestId);
    }

    const profileSettings = parseCompanySettings(company.settings);
    const primaryAdminId = company.admin_id ?? company.created_by ?? null;
    const coAdminCount = await countCoAdmins(context.companyId, primaryAdminId);

    return jsonSuccess(
      {
        has_company: true,
        company_id: company.company_id.toString(),
        company_name: company.name,
        company_slug: company.company_slug,
        description: company.description,
        email: company.email,
        logo_url: company.logo_url,
        industry: readProfileString(profileSettings, "industry"),
        phone: readProfileString(profileSettings, "phone"),
        address: readProfileString(profileSettings, "address"),
        pending_name_change: company.pending_name_change,
        security_code: company.security_code,
        approval_required: company.approval_required,
        is_public: company.is_public,
        company_theme: company.company_theme,
        subscription_tier: company.subscription_tier,
        max_employees: company.max_employees,
        current_employees: company.current_employees,
        status: company.status,
        my_role: context.role,
        is_primary_admin: context.isPrimaryAdmin,
        is_co_admin: context.role === "admin" && !context.isPrimaryAdmin,
        co_admin_count: coAdminCount,
        co_admin_limit: MAX_CO_ADMINS,
        my_permissions: Object.entries(context.permissions)
          .filter(([, enabled]) => enabled)
          .map(([key]) => key),
        joined_at: context.joinedAt?.toISOString() ?? null,
      },
      { requestId, responseTime: Date.now() - startedAt }
    );
  } catch (error) {
    if (error instanceof AppError) {
      if (String(error.code) === CompanyErrorCode.COMPANY_NOT_FOUND) {
        // Treat missing company context as an empty state for the dashboard.
        return emptyCompanyResponse();
      }
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/my-company GET] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
