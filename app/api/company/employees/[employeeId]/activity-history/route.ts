import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";
import { getClientIp } from "@/server/lib/auth";
import {
  parseEmployeeIdParam,
  requireManageEmployeesAuth,
  resolveCompanyEmployeeTarget,
} from "@/server/lib/company-employee-profile";

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function safeParseDetails(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function relatesToEmployee(
  details: Record<string, unknown> | null,
  employeeId: string,
  employeeUserId: string,
): boolean {
  if (!details) return false;
  const detailEmployeeId = String(details.employeeId ?? details.employee_id ?? "");
  const detailEmployeeUserId = String(
    details.employeeUserId ?? details.employee_user_id ?? "",
  );
  return detailEmployeeId === employeeId || detailEmployeeUserId === employeeUserId;
}

/**
 * Narrow employee-scoped history for actors with manage_employees.
 * Does not expose the full company audit feed (primary-admin-only).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rl = checkRateLimit("company-employee-activity-history", ip);
    if (!rl.allowed) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) },
      );
    }

    const authCtx = await requireManageEmployeesAuth(request);
    const { employeeId } = await params;
    const parsedEmployeeId = parseEmployeeIdParam(employeeId, authCtx.requestId);
    const employee = await resolveCompanyEmployeeTarget({
      employeeId: parsedEmployeeId,
      companyId: authCtx.context.companyId,
      requestId: authCtx.requestId,
    });

    const { searchParams } = new URL(request.url);
    const page = parsePositiveInt(searchParams.get("page"), 1, 1000);
    const limit = parsePositiveInt(searchParams.get("limit"), 20, 50);

    const employeeIdStr = employee.employee_id.toString();
    const employeeUserIdStr = employee.user_id.toString();

    // Pull a recent window of employee.* audits for the company, then filter by
    // details.employeeId / employeeUserId (audit actor is the admin, not the employee).
    const candidateRows = await prisma.companyAuditLog.findMany({
      where: {
        company_id: authCtx.context.companyId,
        action: { startsWith: "employee." },
        OR: [
          { details: { contains: `"employeeId":"${employeeIdStr}"` } },
          { details: { contains: `"employeeUserId":"${employeeUserIdStr}"` } },
          { details: { contains: employeeIdStr } },
          { details: { contains: employeeUserIdStr } },
        ],
      },
      orderBy: { created_at: "desc" },
      take: 300,
      select: {
        log_id: true,
        user_id: true,
        action: true,
        details: true,
        created_at: true,
        user: {
          select: {
            first_name: true,
            last_name: true,
            email: true,
          },
        },
      },
    });

    const filtered = candidateRows.filter((row) =>
      relatesToEmployee(safeParseDetails(row.details), employeeIdStr, employeeUserIdStr),
    );

    const total = filtered.length;
    const start = (page - 1) * limit;
    const pageRows = filtered.slice(start, start + limit);

    return jsonSuccess(
      {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
        employee_id: employeeIdStr,
        user_id: employeeUserIdStr,
        logs: pageRows.map((row) => ({
          log_id: row.log_id.toString(),
          actor_name: `${row.user.first_name} ${row.user.last_name}`.trim(),
          actor_email: row.user.email,
          action: row.action,
          details: safeParseDetails(row.details),
          created_at: row.created_at,
        })),
      },
      { requestId: authCtx.requestId, responseTime: Date.now() - authCtx.startedAt },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }
    console.error("[api/company/employees/activity-history GET] Unexpected error", {
      requestId,
      error,
    });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
