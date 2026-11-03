import { NextRequest } from "next/server";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import {
  actorUserIdFromSession,
  ensureCompanyPermission,
  ensureCompanyRole,
  resolveCompanyActorContext,
} from "@/server/lib/company";
import { CompanyAdminErrorCode, createCompanyAdminError } from "@/lib/errors/company-admin-errors";
import { resendInvitation } from "@/lib/services/company-employee-invite.service";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rateLimit = checkRateLimit("company-invite-resend", ip);
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

    const actorUserId = actorUserIdFromSession(auth);
    const context = await resolveCompanyActorContext({ userId: actorUserId, requestId });
    ensureCompanyRole(context, ["admin", "manager"], requestId);
    ensureCompanyPermission(context, "manage_employees", requestId);

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
    const invitationIdRaw = body.invitation_id;
    if (typeof invitationIdRaw !== "string" && typeof invitationIdRaw !== "number") {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.INVALID_REQUEST,
        "invitation_id is required.",
        400,
        requestId,
      );
}

 const trimmed = String(invitationIdRaw).trim();
 if (!/^\d+$/.test(trimmed)) {
  throw createCompanyAdminError(
    CompanyAdminErrorCode.INVALID_REQUEST,
    "invitation_id must be a positive integer string.",
    400,
    requestId,
  );
}

    const invitationId = BigInt(trimmed);
    if (invitationId <= 0) {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.INVALID_REQUEST,
        "invitation_id must be a positive integer.",
        400,
        requestId,
      );
    }

    const cooldown = checkRateLimit(
      "company-invite-resend-cooldown",
      `${context.companyId.toString()}:${trimmed}`,
    );
    if (!cooldown.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil(cooldown.retryAfterMs / 1000));
      throw createCompanyAdminError(
        CompanyAdminErrorCode.RATE_LIMIT_EXCEEDED,
        `Please wait ${retryAfterSeconds} seconds before resending this invitation.`,
        429,
        requestId,
        { tag: "[COMPANY_INVITE_API]", reason: "cooldown", retryAfterSeconds },
      );
    }

    const result = await resendInvitation({
      companyId: context.companyId,
      invitationId,
      invitedBy: actorUserId,
      request,
    });

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        not_found: 404,
        already_accepted: 409,
        already_connected: 409,
        invalid: 400,
        failed: 403,
        email_failed: 502,
        cooldown: 429,
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
        invitation_id: result.invitationId,
        email: result.email,
        email_sent: result.emailSent,
        expires_at: result.expiresAt.toISOString(),
        message: result.message,
      },
      { requestId, responseTime: Date.now() - startedAt },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/invitations/resend POST] Unexpected error", {
      requestId,
      error,
    });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
