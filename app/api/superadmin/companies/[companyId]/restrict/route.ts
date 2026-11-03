import { NextRequest, NextResponse } from "next/server";
import { withCompanySuperAdmin, type SuperAdminCompanyContext } from "@/lib/auth/superadmin-middleware";
import {
  SuperAdminErrorCode,
  createSuperAdminError,
  toSuperAdminErrorResponse,
} from "@/lib/errors/superadmin-errors";
import { toSuperAdminErrorNextResponse } from "@/lib/errors/superadmin-http";
import { checkSuperadminCompanyRateLimit } from "@/lib/rate-limit/superadmin-company-limits";
import { getClientIp, getUserAgent } from "@/server/lib/auth";
import { logCompanyAudit } from "@/server/lib/company";
import { prisma } from "@/server/lib/prisma";

type RouteContext = SuperAdminCompanyContext & {
  params: Promise<{ companyId: string }>;
};

function parseCompanyId(raw: string, requestId: string): bigint {
  if (!/^\d+$/.test(raw)) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "Invalid companyId path parameter.",
      400,
      requestId,
      { companyId: raw }
    );
  }

  return BigInt(raw);
}

export const POST = withCompanySuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, originalUser } = context;

  try {
    const rateLimit = checkSuperadminCompanyRateLimit(req, "COMPANY_RESTRICT", String(originalUser.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many company restrict requests. Please try again later.",
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

    const { companyId } = await context.params;
    const parsedCompanyId = parseCompanyId(companyId, requestId);
    const restrictionReason = "Company restricted by superadmin";
    const now = new Date();
    const performerId = BigInt(originalUser.id);

    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.findUnique({
        where: { company_id: parsedCompanyId },
        select: { company_id: true, status: true, admin_id: true },
      });

      if (!company) {
        throw createSuperAdminError(
          SuperAdminErrorCode.IMPERSONATION_TARGET_NOT_FOUND,
          "Company not found.",
          404,
          requestId,
          { companyId }
        );
      }

      if (company.status === "restricted") {
        throw createSuperAdminError(
          SuperAdminErrorCode.COMPANY_ALREADY_RESTRICTED,
          "Company is already restricted.",
          409,
          requestId,
          { companyId }
        );
      }

      await tx.company.update({
        where: { company_id: parsedCompanyId },
        data: {
          status: "restricted",
          updated_at: now,
        },
      });

      const [employees, usersWithCompany] = await Promise.all([
        tx.companyEmployee.findMany({
          where: { company_id: parsedCompanyId },
          select: { user_id: true },
        }),
        tx.user.findMany({
          where: { company_id: parsedCompanyId },
          select: { user_id: true, is_restricted: true },
        }),
      ]);

      const userIds = new Set<bigint>();
      if (company.admin_id) userIds.add(company.admin_id);
      for (const row of employees) userIds.add(row.user_id);
      for (const row of usersWithCompany) userIds.add(row.user_id);

      const userIdList = Array.from(userIds);
      let usersSuspended = 0;
      let sessionsRevoked = 0;

      if (userIdList.length > 0) {
        const suspendResult = await tx.user.updateMany({
          where: {
            user_id: { in: userIdList },
            is_restricted: false,
          },
          data: {
            is_restricted: true,
            restricted_until: null,
            restriction_reason: restrictionReason,
            restricted_by: performerId,
            restricted_at: now,
          },
        });
        usersSuspended = suspendResult.count;

        const sessionRevokeResult = await tx.session.deleteMany({
          where: { user_id: { in: userIdList } },
        });
        sessionsRevoked = sessionRevokeResult.count;
      }

      const employeeDeactivate = await tx.companyEmployee.updateMany({
        where: { company_id: parsedCompanyId, is_active: true },
        data: {
          is_active: false,
          restricted_at: now,
          restricted_reason: restrictionReason,
        },
      });

      return {
        company_id: company.company_id.toString(),
        status: "restricted" as const,
        users_suspended: usersSuspended,
        employees_deactivated: employeeDeactivate.count,
        sessions_revoked: sessionsRevoked,
      };
    });

    await logCompanyAudit({
      companyId: parsedCompanyId,
      userId: performerId,
      action: "company.restricted",
      details: {
        users_suspended: result.users_suspended,
        employees_deactivated: result.employees_deactivated,
        sessions_revoked: result.sessions_revoked,
        performed_by: originalUser.id,
      },
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
      requestId,
    });

    return NextResponse.json({
      success: true,
      data: result,
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
      "Failed to restrict company"
    );
  }
});
