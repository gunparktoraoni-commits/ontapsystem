import { NextRequest, NextResponse } from "next/server";
import { withCompanySuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  SuperAdminErrorCode,
  toSuperAdminErrorResponse,
} from "@/lib/errors/superadmin-errors";
import { toSuperAdminErrorNextResponse } from "@/lib/errors/superadmin-http";
import { checkSuperadminCompanyRateLimit } from "@/lib/rate-limit/superadmin-company-limits";

export const GET = withCompanySuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, originalUser, effectiveUser, impersonation } = context;

  try {
    const rateLimit = checkSuperadminCompanyRateLimit(req, "IMPERSONATION_STATUS", String(originalUser.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many impersonation status requests. Please try again later.",
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

    return NextResponse.json({
      success: true,
      data: {
        active: Boolean(impersonation),
        original_user: {
          user_id: originalUser.userId.toString(),
          email: originalUser.email,
          role: originalUser.role,
        },
        effective_user: {
          user_id: effectiveUser.userId.toString(),
          email: effectiveUser.email,
          role: effectiveUser.role,
        },
        impersonation: impersonation
          ? {
              token_id: impersonation.tokenId,
              superadmin_user_id: impersonation.superadminUserId,
              target_user_id: impersonation.targetUserId,
              session_id: impersonation.sessionId,
              reason: impersonation.reason,
              source: impersonation.source,
              created_at: impersonation.createdAt.toISOString(),
              expires_at: impersonation.expiresAt.toISOString(),
            }
          : null,
      },
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return toSuperAdminErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to fetch impersonation status"
    );
  }
});
