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
import { prisma } from "@/server/lib/prisma";
import {
  attachImpersonationCookie,
  createSuperadminImpersonationToken,
} from "@/server/lib/superadmin-impersonation";

type StartImpersonationInput = {
  target_user_id: number;
  reason?: string;
  ttl_minutes?: number;
};

function parseInput(input: unknown, requestId: string): StartImpersonationInput {
  if (!input || typeof input !== "object") {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "Body must be a JSON object.",
      400,
      requestId
    );
  }

  const payload = input as Record<string, unknown>;
  const targetUserId = Number(payload.target_user_id);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "target_user_id must be a positive integer.",
      400,
      requestId,
      { target_user_id: payload.target_user_id }
    );
  }

  const reason = typeof payload.reason === "string" ? payload.reason.trim() : undefined;
  if (reason && reason.length > 1000) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "reason must be at most 1000 characters.",
      400,
      requestId
    );
  }

  const ttlMinutesRaw = payload.ttl_minutes;
  if (
    ttlMinutesRaw !== undefined &&
    (!Number.isInteger(ttlMinutesRaw) || Number(ttlMinutesRaw) < 5 || Number(ttlMinutesRaw) > 120)
  ) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "ttl_minutes must be an integer between 5 and 120.",
      400,
      requestId,
      { ttl_minutes: ttlMinutesRaw }
    );
  }

  return {
    target_user_id: targetUserId,
    ...(reason ? { reason } : {}),
    ...(ttlMinutesRaw !== undefined ? { ttl_minutes: Number(ttlMinutesRaw) } : {}),
  };
}

export const POST = withCompanySuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user, originalUser } = context;

  try {
    const rateLimit = checkSuperadminCompanyRateLimit(req, "IMPERSONATION_START", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many impersonation start requests. Please try again later.",
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

    let input: StartImpersonationInput;
    try {
      input = parseInput(await req.json(), requestId);
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

    if (input.target_user_id === originalUser.id) {
      throw createSuperAdminError(
        SuperAdminErrorCode.IMPERSONATION_NOT_ALLOWED,
        "You cannot impersonate yourself.",
        409,
        requestId
      );
    }

    const targetUser = await prisma.user.findUnique({
      where: { user_id: BigInt(input.target_user_id) },
      select: {
        user_id: true,
        email: true,
        role: true,
        first_name: true,
        last_name: true,
        deactivated_flag: true,
        deleted_at: true,
      },
    });

    if (!targetUser || targetUser.deactivated_flag || targetUser.deleted_at) {
      throw createSuperAdminError(
        SuperAdminErrorCode.IMPERSONATION_TARGET_NOT_FOUND,
        "Impersonation target user not found or inactive.",
        404,
        requestId,
        { target_user_id: input.target_user_id }
      );
    }

    if (targetUser.role === "super_admin") {
      throw createSuperAdminError(
        SuperAdminErrorCode.IMPERSONATION_NOT_ALLOWED,
        "Impersonating another superadmin is not allowed.",
        409,
        requestId,
        {
          target_user_id: input.target_user_id,
          target_role: targetUser.role,
        }
      );
    }

    const targetUserId = BigInt(input.target_user_id);
    const adminCompany = await prisma.company.findFirst({
      where: {
        OR: [
          { admin_id: targetUserId },
          {
            admin_id: null,
            created_by: targetUserId,
          },
        ],
      },
      select: { company_id: true, status: true },
    });

    if (!adminCompany) {
      throw createSuperAdminError(
        SuperAdminErrorCode.IMPERSONATION_NOT_ALLOWED,
        "Impersonation target is not assigned as a company primary administrator.",
        409,
        requestId,
        { target_user_id: input.target_user_id }
      );
    }

    if (adminCompany.status === "restricted") {
      throw createSuperAdminError(
        SuperAdminErrorCode.IMPERSONATION_NOT_ALLOWED,
        "Cannot impersonate a company that is restricted.",
        409,
        requestId,
        { company_id: adminCompany.company_id.toString(), status: adminCompany.status }
      );
    }

    if (adminCompany.status !== "active") {
      throw createSuperAdminError(
        SuperAdminErrorCode.IMPERSONATION_NOT_ALLOWED,
        "Can only impersonate active companies.",
        409,
        requestId,
        { company_id: adminCompany.company_id.toString(), status: adminCompany.status }
      );
    }

    const created = await createSuperadminImpersonationToken({
      superadminUserId: originalUser.id,
      targetUserId: input.target_user_id,
      reason: input.reason,
      ttlMinutes: input.ttl_minutes,
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
    });

    const response = NextResponse.json({
      success: true,
      data: {
        token_id: created.tokenId,
        impersonation_token: created.rawToken,
        expires_at: created.expiresAt.toISOString(),
        reason: input.reason ?? null,
        target_user: {
          user_id: targetUser.user_id.toString(),
          name: `${targetUser.first_name} ${targetUser.last_name}`.trim(),
          email: targetUser.email,
          role: targetUser.role,
        },
        supported_transport: ["header", "cookie"],
      },
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });

    attachImpersonationCookie(response, created.rawToken, created.expiresAt);
    return response;
  } catch (error) {
    return toSuperAdminErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to start impersonation"
    );
  }
});
