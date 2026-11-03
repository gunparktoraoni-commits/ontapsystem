import { NextRequest, NextResponse } from "next/server";
import { withCompanySuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  SuperAdminErrorCode,
  createSuperAdminError,
  toSuperAdminErrorResponse,
} from "@/lib/errors/superadmin-errors";
import { toSuperAdminErrorNextResponse } from "@/lib/errors/superadmin-http";
import { checkSuperadminCompanyRateLimit } from "@/lib/rate-limit/superadmin-company-limits";
import { getClientIp, getUserAgent } from "@/server/lib/auth";
import {
  clearImpersonationCookie,
  getImpersonationTokenFromRequest,
  revokeSuperadminImpersonationTokenById,
  revokeSuperadminImpersonationTokenByRawToken,
} from "@/server/lib/superadmin-impersonation";

type EndImpersonationInput = {
  reason?: string;
  token?: string;
};

function parseInput(input: unknown, requestId: string): EndImpersonationInput {
  if (input === undefined || input === null) {
    return {};
  }

  if (typeof input !== "object") {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "Body must be a JSON object when provided.",
      400,
      requestId
    );
  }

  const payload = input as Record<string, unknown>;
  const reason = typeof payload.reason === "string" ? payload.reason.trim() : undefined;
  if (reason && reason.length > 1000) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "reason must be at most 1000 characters.",
      400,
      requestId
    );
  }

  const token = typeof payload.token === "string" ? payload.token.trim() : undefined;
  if (token !== undefined && token.length === 0) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "token cannot be empty when provided.",
      400,
      requestId
    );
  }

  return {
    ...(reason ? { reason } : {}),
    ...(token ? { token } : {}),
  };
}

export const POST = withCompanySuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, originalUser, impersonation } = context;

  try {
    const rateLimit = checkSuperadminCompanyRateLimit(req, "IMPERSONATION_END", String(originalUser.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many impersonation end requests. Please try again later.",
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

    let body: EndImpersonationInput = {};
    const rawBody = await req.text();
    if (rawBody.trim().length > 0) {
      try {
        body = parseInput(JSON.parse(rawBody), requestId);
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
    }

    const reason = body.reason ?? "Ended by superadmin";
    let ended = false;
    let endedTokenId: number | null = null;

    if (body.token) {
      const result = await revokeSuperadminImpersonationTokenByRawToken({
        rawToken: body.token,
        endedBySuperadminUserId: originalUser.id,
        reason,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      if (result === "forbidden") {
        throw createSuperAdminError(
          SuperAdminErrorCode.IMPERSONATION_NOT_ALLOWED,
          "The provided impersonation token does not belong to the authenticated superadmin.",
          403,
          requestId
        );
      }

      if (result === "not_found") {
        throw createSuperAdminError(
          SuperAdminErrorCode.IMPERSONATION_INVALID_TOKEN,
          "Impersonation token not found.",
          404,
          requestId
        );
      }

      ended = true;
    } else if (impersonation) {
      const revoked = await revokeSuperadminImpersonationTokenById({
        tokenId: impersonation.tokenId,
        endedBySuperadminUserId: originalUser.id,
        reason,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      ended = revoked;
      endedTokenId = impersonation.tokenId;
    } else {
      const tokenFromRequest = getImpersonationTokenFromRequest(req);
      if (!tokenFromRequest.token) {
        throw createSuperAdminError(
          SuperAdminErrorCode.IMPERSONATION_INVALID_TOKEN,
          "No active impersonation token found on this request.",
          404,
          requestId
        );
      }

      const result = await revokeSuperadminImpersonationTokenByRawToken({
        rawToken: tokenFromRequest.token,
        endedBySuperadminUserId: originalUser.id,
        reason,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      if (result === "forbidden") {
        throw createSuperAdminError(
          SuperAdminErrorCode.IMPERSONATION_NOT_ALLOWED,
          "The request token does not belong to the authenticated superadmin.",
          403,
          requestId
        );
      }

      if (result === "not_found") {
        throw createSuperAdminError(
          SuperAdminErrorCode.IMPERSONATION_INVALID_TOKEN,
          "Impersonation token not found.",
          404,
          requestId
        );
      }

      ended = true;
    }

    const response = NextResponse.json({
      success: true,
      data: {
        ended,
        token_id: endedTokenId,
        reason,
      },
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });

    clearImpersonationCookie(response);
    return response;
  } catch (error) {
    return toSuperAdminErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to end impersonation"
    );
  }
});
