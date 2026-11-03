import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { actorUserIdFromSession, ensureCompanyPermission,
  ensureCompanyRole,
  isCoAdminMember,
  logCompanyAudit,
  resolveCompanyActorContext, } from "@/server/lib/company";
import { randomId } from "@/server/lib/notifications";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";
import {
  CompanyDashboardService,
  resolveUserProfileImages,
} from "@/lib/services/company-dashboard.service";
import { getDateRange } from "@/lib/utils/date-range";

function toEmployeeId(value: string, requestId: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw createCompanyError(CompanyErrorCode.INVALID_EMPLOYEE_DATA, "Invalid employee id.", 400, requestId);
  }
  return BigInt(value);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ employeeId: string }> }) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rl = checkRateLimit("company-employee-detail", ip);
    if (!rl.allowed) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) }
      );
    }

    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      throw createCompanyError(CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION, "Authentication required.", 401, requestId);
    }

    const context = await resolveCompanyActorContext({
      userId: actorUserIdFromSession(auth),
      requestId,
    });
    ensureCompanyRole(context, ["admin", "manager"], requestId);

    const { employeeId } = await params;
    const parsedEmployeeId = toEmployeeId(employeeId, requestId);

    const employee = await prisma.companyEmployee.findFirst({
      where: {
        employee_id: parsedEmployeeId,
        company_id: context.companyId,
      },
      include: {
        user: {
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            email: true,
            profile_url: true,
            created_at: true,
            userActivity: {
              select: {
                last_active: true,
              },
            },
          },
        },
        activitySummaries: {
          orderBy: { calculated_at: "desc" },
          take: 12,
        },
      },
    });

    if (!employee) {
      throw createCompanyError(CompanyErrorCode.EMPLOYEE_NOT_FOUND, "Employee not found.", 404, requestId);
    }

    const company = await prisma.company.findUnique({
      where: { company_id: context.companyId },
      select: { admin_id: true, created_by: true },
    });

    const monthRange = getDateRange("this_month");
    const dashboardService = new CompanyDashboardService(context.companyId, requestId);
    const [bizcardCount, profileImages, activityByUser] = await Promise.all([
      prisma.bizcard.count({
        where: {
          user_id: employee.user_id,
          deactivated_flag: false,
        },
      }),
      resolveUserProfileImages([employee.user_id]),
      dashboardService.getActivityMetricsByUser(
        [employee.user_id],
        monthRange.start,
        monthRange.end,
      ),
    ]);

    const latestSummary = employee.activitySummaries[0] ?? null;
    const live = activityByUser.get(employee.user_id.toString());
    const latestActivity = {
      period: "this_month",
      profile_views: live?.profile_views ?? latestSummary?.profile_views ?? 0,
      contact_saves: live?.contact_saves ?? latestSummary?.contact_saves ?? 0,
      inquiries_count: live?.inquiries_count ?? latestSummary?.inquiries_count ?? 0,
      connections_count: latestSummary?.connections_count ?? 0,
      rank_score: Number(latestSummary?.rank_score ?? 0),
      calculated_at: latestSummary?.calculated_at ?? new Date(),
    };

    return jsonSuccess(
      {
        employee: {
          employee_id: employee.employee_id.toString(),
          user_id: employee.user_id.toString(),
          name: `${employee.user.first_name} ${employee.user.last_name}`.trim(),
          email: employee.user.email,
          profile_image:
            profileImages.get(employee.user_id.toString()) ?? employee.user.profile_url,
          role: employee.role,
          is_primary_admin:
            company?.admin_id === employee.user_id ||
            (company?.admin_id == null && company?.created_by === employee.user_id),
          is_co_admin:
            employee.role === "admin" &&
            company?.admin_id != null &&
            company.admin_id !== employee.user_id,
          permissions: employee.permissions
            ? (() => {
                try {
                  return JSON.parse(employee.permissions) as Record<string, boolean>;
                } catch {
                  return null;
                }
              })()
            : null,
          is_active: employee.is_active,
          joined_at: employee.joined_at,
          restricted_at: employee.restricted_at,
          restricted_reason: employee.restricted_reason,
          last_active: employee.user.userActivity?.last_active ?? null,
          account_created_at: employee.user.created_at,
          bizcard_count: bizcardCount,
        },
        activity: {
          latest: latestActivity,
          history: employee.activitySummaries.map((summary) => ({
            period: summary.period,
            profile_views: summary.profile_views,
            contact_saves: summary.contact_saves,
            inquiries_count: summary.inquiries_count,
            connections_count: summary.connections_count,
            rank_score: Number(summary.rank_score),
            calculated_at: summary.calculated_at,
          })),
        },
      },
      { requestId, responseTime: Date.now() - startedAt }
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/employees/[employeeId] GET] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ employeeId: string }> }) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rl = checkRateLimit("company-employee-remove", ip);
    if (!rl.allowed) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) }
      );
    }

    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      throw createCompanyError(CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION, "Authentication required.", 401, requestId);
    }

    const context = await resolveCompanyActorContext({
      userId: actorUserIdFromSession(auth),
      requestId,
    });
    ensureCompanyRole(context, ["admin", "manager"], requestId);
    ensureCompanyPermission(context, "manage_employees", requestId);

    const { employeeId } = await params;
    const parsedEmployeeId = toEmployeeId(employeeId, requestId);

    const [employee, company] = await Promise.all([
      prisma.companyEmployee.findFirst({
        where: {
          employee_id: parsedEmployeeId,
          company_id: context.companyId,
        },
        select: {
          employee_id: true,
          user_id: true,
          role: true,
        },
      }),
      prisma.company.findUnique({
        where: { company_id: context.companyId },
        select: { admin_id: true, created_by: true },
      }),
    ]);

    if (!employee) {
      throw createCompanyError(CompanyErrorCode.EMPLOYEE_NOT_FOUND, "Employee not found.", 404, requestId);
    }

    if (employee.user_id === context.userId) {
      throw createCompanyError(CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION, "You cannot remove yourself from the company.", 403, requestId);
    }

    const targetIsPrimary =
      company?.admin_id === employee.user_id ||
      (company?.admin_id == null && company?.created_by === employee.user_id);
    if (targetIsPrimary) {
      throw createCompanyError(CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION, "The primary company admin cannot be removed.", 403, requestId);
    }

    if (isCoAdminMember(employee.role, employee.user_id, company?.admin_id ?? null) && !context.isPrimaryAdmin) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "Only the primary company admin can remove co-admins.",
        403,
        requestId,
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.companyEmployee.delete({
        where: { employee_id: employee.employee_id },
      });

      await tx.company.updateMany({
        where: { company_id: context.companyId, current_employees: { gt: 0 } },
        data: { current_employees: { decrement: 1 } },
      });

      const memberUser = await tx.user.findUnique({
        where: { user_id: employee.user_id },
        select: { company_id: true, role: true },
      });

      if (memberUser && memberUser.company_id === context.companyId) {
        await tx.user.update({
          where: { user_id: employee.user_id },
          data: {
            company_id: null,
            ...(memberUser.role === "company_admin" ? { role: "user" } : {}),
          },
        });
      }
    });

    await prisma.userNotification.create({
      data: {
        id: randomId("notif"),
        user_id: employee.user_id,
        event_type: "system_update",
        priority: "medium",
        title: "You were removed from your company",
        message: "A company admin removed you from the company workspace.",
        metadata: JSON.stringify({
          companyId: context.companyId.toString(),
          action: "removed",
        }),
      },
    });

    await logCompanyAudit({
      companyId: context.companyId,
      userId: context.userId,
      action: "employee.removed",
      requestId,
      details: {
        employeeUserId: employee.user_id.toString(),
        role: employee.role,
      },
    });

    return jsonSuccess(
      {
        success: true,
        employee: {
          employee_id: employee.employee_id.toString(),
          user_id: employee.user_id.toString(),
        },
      },
      { requestId, responseTime: Date.now() - startedAt }
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/employees/[employeeId] DELETE] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
