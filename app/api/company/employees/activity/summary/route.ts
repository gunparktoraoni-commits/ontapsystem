import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { actorUserIdFromSession, ensureCompanyRole,
  resolveCompanyActorContext, } from "@/server/lib/company";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rl = checkRateLimit("company-employees-activity-summary", ip);
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
    ensureCompanyRole(context, ["admin", "manager", "employee"], requestId);

    const summaries = await prisma.employeeActivitySummary.findMany({
      where: {
        employee: {
          company_id: context.companyId,
        },
        period: "monthly",
      },
      include: {
        employee: {
          select: {
            employee_id: true,
            role: true,
            is_active: true,
            user: {
              select: {
                user_id: true,
                first_name: true,
                last_name: true,
              },
            },
          },
        },
      },
      orderBy: [{ rank_score: "desc" }, { calculated_at: "desc" }],
      take: 200,
    });

    const totalEmployees = await prisma.companyEmployee.count({
      where: {
        company_id: context.companyId,
      },
    });

    const activeEmployees = summaries.filter((s) => s.employee.is_active);
    const totals = activeEmployees.reduce(
      (acc, cur) => {
        acc.profileViews += cur.profile_views;
        acc.contactSaves += cur.contact_saves;
        acc.inquiries += cur.inquiries_count;
        acc.connections += cur.connections_count;
        acc.score += Number(cur.rank_score);
        return acc;
      },
      {
        profileViews: 0,
        contactSaves: 0,
        inquiries: 0,
        connections: 0,
        score: 0,
      }
    );

    const count = Math.max(activeEmployees.length, 1);

    return jsonSuccess(
      {
        company_id: context.companyId.toString(),
        totals: {
          employees_total: totalEmployees,
          employees_active: activeEmployees.length,
          profile_views: totals.profileViews,
          contact_saves: totals.contactSaves,
          inquiries_count: totals.inquiries,
          connections_count: totals.connections,
          average_rank_score: Number((totals.score / count).toFixed(2)),
        },
        top_employees: summaries.slice(0, 10).map((row, index) => ({
          rank: index + 1,
          employee_id: row.employee.employee_id.toString(),
          user_id: row.employee.user.user_id.toString(),
          name: `${row.employee.user.first_name} ${row.employee.user.last_name}`.trim(),
          role: row.employee.role,
          is_active: row.employee.is_active,
          rank_score: Number(row.rank_score),
          metrics: {
            profile_views: row.profile_views,
            contact_saves: row.contact_saves,
            inquiries_count: row.inquiries_count,
            connections_count: row.connections_count,
          },
          calculated_at: row.calculated_at,
        })),
      },
      { requestId, responseTime: Date.now() - startedAt }
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/employees/activity/summary GET] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
