import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { actorUserIdFromSession, ensureCompanyRole,
  resolveCompanyActorContext, } from "@/server/lib/company";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";

export async function GET(request: NextRequest, { params }: { params: Promise<{ employeeId: string }> }) {
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

    const { employeeId } = await params;
    if (!/^\d+$/.test(employeeId)) {
      throw createCompanyError(CompanyErrorCode.INVALID_EMPLOYEE_DATA, "Invalid employee id.", 400, requestId);
    }

    const employee = await prisma.companyEmployee.findFirst({
      where: {
        employee_id: BigInt(employeeId),
        company_id: context.companyId,
      },
      select: {
        employee_id: true,
        user_id: true,
        role: true,
        is_active: true,
        joined_at: true,
      },
    });

    if (!employee) {
      throw createCompanyError(CompanyErrorCode.EMPLOYEE_NOT_FOUND, "Employee not found.", 404, requestId);
    }

    const summaries = await prisma.employeeActivitySummary.findMany({
      where: {
        employee_id: employee.employee_id,
      },
      orderBy: { calculated_at: "desc" },
      take: 24,
    });

    const totalActivity = summaries.reduce(
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

    const count = Math.max(summaries.length, 1);

    return jsonSuccess(
      {
        employee: {
          employee_id: employee.employee_id.toString(),
          user_id: employee.user_id.toString(),
          role: employee.role,
          is_active: employee.is_active,
          joined_at: employee.joined_at,
        },
        totals: {
          profile_views: totalActivity.profileViews,
          contact_saves: totalActivity.contactSaves,
          inquiries_count: totalActivity.inquiries,
          connections_count: totalActivity.connections,
          average_rank_score: Number((totalActivity.score / count).toFixed(2)),
          data_points: summaries.length,
        },
        activity_history: summaries.map((summary) => ({
          period: summary.period,
          period_date: summary.period_date,
          profile_views: summary.profile_views,
          contact_saves: summary.contact_saves,
          inquiries_count: summary.inquiries_count,
          connections_count: summary.connections_count,
          rank_score: Number(summary.rank_score),
          calculated_at: summary.calculated_at,
        })),
      },
      { requestId, responseTime: Date.now() - startedAt }
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/employees/[employeeId]/activity GET] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
