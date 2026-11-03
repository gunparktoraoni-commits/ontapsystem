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
import { cancelInvitation } from "@/lib/services/company-employee-invite.service";

function parseInvitationId(raw: string, requestId: string): bigint {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw createCompanyAdminError(
      CompanyAdminErrorCode.INVALID_REQUEST,
      "invitation_id must be a positive integer.",
      400,
      requestId,
    );
  }

  const invitationId = BigInt(trimmed);
  if (invitationId <= BigInt(0)) {
    throw createCompanyAdminError(
      CompanyAdminErrorCode.INVALID_REQUEST,
      "invitation_id must be a positive integer.",
      400,
      requestId,
    );
  }

  return invitationId;
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ invitationId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rateLimit = checkRateLimit("company-invite-cancel", ip);
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
    const actorContext = await resolveCompanyActorContext({ userId: actorUserId, requestId });
    ensureCompanyRole(actorContext, ["admin", "manager"], requestId);
    ensureCompanyPermission(actorContext, "manage_employees", requestId);

    const { invitationId: invitationIdRaw } = await context.params;
    const invitationId = parseInvitationId(invitationIdRaw, requestId);

    const result = await cancelInvitation({
      companyId: actorContext.companyId,
      invitationId,
    });

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        not_found: 404,
        already_accepted: 409,
        invalid: 400,
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
        message: result.message,
      },
      { requestId, responseTime: Date.now() - startedAt },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/invitations/[invitationId] DELETE] Unexpected error", {
      requestId,
      error,
    });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
