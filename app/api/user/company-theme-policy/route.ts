import { NextRequest } from "next/server";
import { getClientIp, resolveRequestSession, resolveEffectiveUserId } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { resolveCompanyThemePolicyForUser } from "@/server/lib/company";
import { getRequestId, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";

const EMPTY_POLICY = {
  managed_by_company: false,
  company_id: null,
  company_theme: null,
  is_hitachi_company: false,
  is_hitachi_company_admin: false,
  can_change_company_theme: false,
  is_primary_admin: false,
  my_role: null,
  primary_admin_user_id: null,
  primary_admin_name: null,
  primary_admin_avatar_url: null,
} as const;

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rateCheck = checkRateLimit("user-company-theme-policy", ip);
    if (!rateCheck.allowed) {
      return jsonSuccess(
        { ...EMPTY_POLICY },
        { requestId, responseTime: Date.now() - startedAt },
      );
    }

    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      return jsonSuccess(
        { ...EMPTY_POLICY },
        { requestId, responseTime: Date.now() - startedAt },
      );
    }

    // Resolve the impersonated user when a Super Admin is acting on their behalf.
    const effectiveUserId = BigInt(resolveEffectiveUserId(auth));
    const policy = await resolveCompanyThemePolicyForUser(effectiveUserId);

    // Under active impersonation, Super Admin has full authority to change themes
    // in the Design tab — do not lock the UI even if the target is company-managed.
    const managedByCompany = auth.impersonation ? false : policy.managedByCompany;

    return jsonSuccess(
      {
        managed_by_company: managedByCompany,
        company_id: policy.companyId,
        company_theme: policy.companyTheme,
        is_hitachi_company: policy.isHitachiCompany,
        is_hitachi_company_admin: policy.isHitachiCompanyAdmin,
        can_change_company_theme: auth.impersonation
          ? true
          : policy.canChangeCompanyTheme,
        is_primary_admin: policy.isPrimaryAdmin,
        my_role: policy.myRole,
        primary_admin_user_id: policy.primaryAdminUserId,
        primary_admin_name: policy.primaryAdminName,
        primary_admin_avatar_url: policy.primaryAdminAvatarUrl,
        impersonation_theme_override: Boolean(auth.impersonation),
      },
      { requestId, responseTime: Date.now() - startedAt },
    );
  } catch (error) {
    console.error("[api/user/company-theme-policy GET] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
