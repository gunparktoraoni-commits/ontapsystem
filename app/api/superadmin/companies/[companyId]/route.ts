import { NextRequest, NextResponse } from "next/server";
import { withCompanySuperAdmin, type SuperAdminCompanyContext } from "@/lib/auth/superadmin-middleware";
import {
  SuperAdminErrorCode,
  createSuperAdminError,
  toSuperAdminErrorResponse,
} from "@/lib/errors/superadmin-errors";
import { toSuperAdminErrorNextResponse } from "@/lib/errors/superadmin-http";
import { checkSuperadminCompanyRateLimit } from "@/lib/rate-limit/superadmin-company-limits";
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

function safeParseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function toPerson(
  row:
    | {
        user_id: bigint;
        first_name: string;
        last_name: string;
        email: string;
      }
    | null
    | undefined,
) {
  if (!row) return null;
  return {
    user_id: row.user_id.toString(),
    name: `${row.first_name} ${row.last_name}`.trim(),
    email: row.email,
  };
}

export const GET = withCompanySuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, originalUser } = context;

  try {
    const rateLimit = checkSuperadminCompanyRateLimit(req, "DETAIL", String(originalUser.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many company detail requests. Please try again later.",
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

    const company = await prisma.company.findUnique({
      where: { company_id: parsedCompanyId },
      select: {
        company_id: true,
        name: true,
        company_slug: true,
        status: true,
        subscription_tier: true,
        security_code: true,
        approval_required: true,
        company_theme: true,
        settings: true,
        current_employees: true,
        max_employees: true,
        description: true,
        email: true,
        logo_url: true,
        rejection_reason: true,
        pending_name_change: true,
        last_name_change_request: true,
        created_at: true,
        approved_at: true,
        updated_at: true,
        createdByUser: {
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            email: true,
          },
        },
        approvedByUser: {
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            email: true,
          },
        },
        admin: {
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            email: true,
          },
        },
      },
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

    const [employeeCount, activeEmployeeCount, restrictedEmployeeCount, pendingJoinCount, pendingNameChangeCount, auditRows] =
      await Promise.all([
        prisma.companyEmployee.count({ where: { company_id: company.company_id } }),
        prisma.companyEmployee.count({ where: { company_id: company.company_id, is_active: true } }),
        prisma.companyEmployee.count({ where: { company_id: company.company_id, is_active: false } }),
        prisma.companyJoinRequest.count({ where: { company_id: company.company_id, status: "pending" } }),
        prisma.companyNameChangeRequest.count({ where: { company_id: company.company_id, status: "pending" } }),
        prisma.companyAuditLog.findMany({
          where: { company_id: company.company_id },
          orderBy: { created_at: "desc" },
          take: 10,
          select: {
            log_id: true,
            action: true,
            details: true,
            request_id: true,
            created_at: true,
            user: {
              select: {
                user_id: true,
                first_name: true,
                last_name: true,
                email: true,
              },
            },
          },
        }),
      ]);

    const createdBy = toPerson(company.createdByUser);
    const primaryAdmin = toPerson(company.admin) ?? createdBy;

    return NextResponse.json({
      success: true,
      data: {
        company: {
          company_id: company.company_id.toString(),
          company_name: company.name,
          company_slug: company.company_slug,
          status: company.status,
          subscription_tier: company.subscription_tier,
          security_code: company.security_code,
          approval_required: company.approval_required,
          company_theme: company.company_theme,
          settings: safeParseJsonObject(company.settings),
          current_employees: company.current_employees,
          max_employees: company.max_employees,
          description: company.description,
          email: company.email,
          logo_url: company.logo_url,
          rejection_reason: company.rejection_reason,
          pending_name_change: company.pending_name_change,
          last_name_change_request: company.last_name_change_request,
          created_at: company.created_at,
          approved_at: company.approved_at,
          updated_at: company.updated_at,
          created_by: createdBy,
          approved_by: company.approvedByUser
            ? {
                user_id: company.approvedByUser.user_id.toString(),
                name: `${company.approvedByUser.first_name} ${company.approvedByUser.last_name}`.trim(),
                email: company.approvedByUser.email,
              }
            : null,
          admin: primaryAdmin,
        },
        metrics: {
          employees_total: employeeCount,
          employees_active: activeEmployeeCount,
          employees_restricted: restrictedEmployeeCount,
          pending_join_requests: pendingJoinCount,
          pending_name_change_requests: pendingNameChangeCount,
        },
        recent_audit_logs: auditRows.map((row) => ({
          log_id: row.log_id.toString(),
          action: row.action,
          details: row.details,
          request_id: row.request_id,
          created_at: row.created_at,
          actor: {
            user_id: row.user.user_id.toString(),
            name: `${row.user.first_name} ${row.user.last_name}`.trim(),
            email: row.user.email,
          },
        })),
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
      "Failed to fetch company details"
    );
  }
});
