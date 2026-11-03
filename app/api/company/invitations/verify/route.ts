import { NextRequest } from "next/server";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp } from "@/server/lib/auth";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { CompanyAdminErrorCode, createCompanyAdminError } from "@/lib/errors/company-admin-errors";
import { verifyInvitationToken } from "@/lib/services/company-employee-invite.service";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rateLimit = checkRateLimit("company-invite-verify", ip);
    if (!rateLimit.allowed) {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.RATE_LIMIT_EXCEEDED,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rateLimit.retryAfterMs / 1000) },
      );
    }

    const token = (request.nextUrl.searchParams.get("token") ?? "").trim();
    if (!token) {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.INVALID_REQUEST,
        "token query parameter is required.",
        400,
        requestId,
      );
    }

    const result = await verifyInvitationToken(token);
    if (!result.valid) {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.INVITE_FAILED,
        result.reason,
        404,
        requestId,
        { tag: "[COMPANY_INVITE_API]" },
      );
    }

    return jsonSuccess(
      {
        email: result.email,
        company_name: result.companyName,
        role: result.role,
        expires_at: result.expiresAt.toISOString(),
      },
      { requestId, responseTime: Date.now() - startedAt },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/invitations/verify GET] Unexpected error", {
      requestId,
      error,
    });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
