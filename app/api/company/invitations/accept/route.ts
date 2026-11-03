import { NextRequest } from "next/server";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { actorUserIdFromSession } from "@/server/lib/company";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { CompanyAdminErrorCode, createCompanyAdminError } from "@/lib/errors/company-admin-errors";
import { acceptInvitation } from "@/lib/services/company-employee-invite.service";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rateLimit = checkRateLimit("company-invite-accept", ip);
    if (!rateLimit.allowed) {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.RATE_LIMIT_EXCEEDED,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rateLimit.retryAfterMs / 1000) },
      );
    }

    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.PERMISSION_DENIED,
        "Authentication required.",
        401,
        requestId,
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.INVALID_REQUEST,
        "Invalid JSON body.",
        400,
        requestId,
      );
    }

    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.INVALID_REQUEST,
        "token is required.",
        400,
        requestId,
      );
    }

    const result = await acceptInvitation({
      plainToken: token,
      sessionUserId: actorUserIdFromSession(auth),
    });

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        not_found: 404,
        expired: 410,
        already_accepted: 409,
        declined: 409,
        email_mismatch: 403,
        already_in_company: 409,
        other_company: 409,
        limit_reached: 403,
      };

      throw createCompanyAdminError(
        CompanyAdminErrorCode.INVITE_FAILED,
        result.message,
        statusMap[result.reason] ?? 400,
        requestId,
        { tag: "[COMPANY_INVITE_API]", reason: result.reason },
      );
    }

    return jsonSuccess(
      {
        company_id: result.companyId,
        role: result.role,
        redirect_path: result.redirectPath,
        message: "Invitation accepted successfully.",
      },
      { requestId, responseTime: Date.now() - startedAt },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/invitations/accept POST] Unexpected error", {
      requestId,
      error,
    });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
