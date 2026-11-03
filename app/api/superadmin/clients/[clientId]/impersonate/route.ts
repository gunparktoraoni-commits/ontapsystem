import { NextRequest, NextResponse } from "next/server";
import { getClientIp, getUserAgent } from "@/server/lib/auth";
import { withSuperAdmin, type SuperAdminContext } from "@/lib/auth/superadmin-middleware";
import {
  SuperAdminErrorCode,
  createSuperAdminError,
  toSuperAdminErrorResponse,
} from "@/lib/errors/superadmin-errors";
import { toSuperAdminErrorNextResponse } from "@/lib/errors/superadmin-http";
import { checkSuperadminCompanyRateLimit } from "@/lib/rate-limit/superadmin-company-limits";
import { prisma } from "@/server/lib/prisma";
import {
  attachImpersonationCookie,
  createSuperadminImpersonationToken,
} from "@/server/lib/superadmin-impersonation";

type RouteContext = SuperAdminContext & {
  params: Promise<{ clientId: string }>;
};

function parseClientId(raw: string, requestId: string): number {
  if (!/^\d+$/.test(raw)) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "clientId path parameter must be a positive integer.",
      400,
      requestId,
      { clientId: raw },
    );
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "clientId path parameter must be a positive integer.",
      400,
      requestId,
      { clientId: raw },
    );
  }

  return parsed;
}

async function resolveClientId(
  req: NextRequest,
  context: RouteContext,
  requestId: string,
): Promise<number> {
  const rawParams = context.params;
  const params =
    rawParams && typeof (rawParams as Promise<{ clientId: string }>).then === "function"
      ? await (rawParams as Promise<{ clientId: string }>)
      : (rawParams as { clientId?: string } | undefined);

  const fromParams = String(params?.clientId ?? "").trim();
  if (fromParams) {
    return parseClientId(fromParams, requestId);
  }

  // Fallback: /api/superadmin/clients/:id/impersonate
  const parts = req.nextUrl.pathname.split("/").filter(Boolean);
  const clientsIdx = parts.findIndex((part) => part === "clients");
  const fromPath = clientsIdx >= 0 ? String(parts[clientsIdx + 1] ?? "").trim() : "";
  if (fromPath) {
    return parseClientId(fromPath, requestId);
  }

  throw createSuperAdminError(
    SuperAdminErrorCode.INVALID_FILTER,
    "clientId path parameter is required.",
    400,
    requestId,
  );
}

// ── POST /api/superadmin/clients/[clientId]/impersonate ───────────────────────
export const POST = withSuperAdmin(
  async (req: NextRequest, context: RouteContext) => {
    const startedAt = Date.now();
    const { requestId, user } = context;

    try {
      const rateLimit = checkSuperadminCompanyRateLimit(
        req,
        "IMPERSONATION_START",
        String(user.id),
      );
      if (!rateLimit.success) {
        return NextResponse.json(
          toSuperAdminErrorResponse(
            SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
            "Too many impersonation start requests. Please try again later.",
            requestId,
            { retryAfter: rateLimit.retryAfter },
            Date.now() - startedAt,
          ),
          {
            status: 429,
            headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) },
          },
        );
      }

      const targetUserId = await resolveClientId(req, context, requestId);

      if (targetUserId === user.id) {
        throw createSuperAdminError(
          SuperAdminErrorCode.IMPERSONATION_NOT_ALLOWED,
          "You cannot impersonate yourself.",
          409,
          requestId,
        );
      }

      const targetUser = await prisma.user.findUnique({
        where: { user_id: BigInt(targetUserId) },
        select: {
          user_id: true,
          email: true,
          role: true,
          first_name: true,
          last_name: true,
          deactivated_flag: true,
          deleted_at: true,
          is_active: true,
        },
      });

      if (!targetUser || targetUser.deleted_at) {
        throw createSuperAdminError(
          SuperAdminErrorCode.IMPERSONATION_TARGET_NOT_FOUND,
          "User not found.",
          404,
          requestId,
          { target_user_id: targetUserId },
        );
      }

      if (targetUser.role === "super_admin" || targetUser.role === "dev") {
        throw createSuperAdminError(
          SuperAdminErrorCode.IMPERSONATION_NOT_ALLOWED,
          "Impersonating another privileged admin is not allowed.",
          409,
          requestId,
          { target_user_id: targetUserId, target_role: targetUser.role },
        );
      }

      const created = await createSuperadminImpersonationToken({
        superadminUserId: user.id,
        targetUserId,
        reason: `Superadmin client impersonation — user ${targetUserId}`,
        ttlMinutes: 120,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      const response = NextResponse.json({
        success: true,
        data: {
          token_id: created.tokenId,
          impersonation_token: created.rawToken,
          expires_at: created.expiresAt.toISOString(),
          target_user: {
            user_id: targetUser.user_id.toString(),
            name: `${targetUser.first_name ?? ""} ${targetUser.last_name ?? ""}`.trim(),
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
        "Failed to start impersonation",
      );
    }
  },
  { errorMode: "superadmin" },
);
