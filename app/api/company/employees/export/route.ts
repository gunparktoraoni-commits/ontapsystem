import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { getRequestId, jsonAppError, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { actorUserIdFromSession, ensureCompanyPermission, ensureCompanyRole, resolveCompanyActorContext } from "@/server/lib/company";
import { CompanyAdminErrorCode, createCompanyAdminError } from "@/lib/errors/company-admin-errors";

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeStatus(value: string | null): string {
  const normalized = (value ?? "active").toLowerCase();
  if (normalized === "active" || normalized === "restricted" || normalized === "all") {
    return normalized;
  }
  return "active";
}

function normalizeDateFilter(value: string | null): string {
  const normalized = (value ?? "all").toLowerCase();
  if (["today", "yesterday", "this_week", "this_month", "custom", "all"].includes(normalized)) {
    return normalized;
  }
  return "all";
}

function parseDate(value: string | null | undefined, requestId: string): Date {
  if (!value) {
    throw createCompanyAdminError(CompanyAdminErrorCode.INVALID_REQUEST, "Missing or invalid date.", 400, requestId);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createCompanyAdminError(CompanyAdminErrorCode.INVALID_REQUEST, "Invalid date format.", 400, requestId, { value });
  }

  return date;
}

function getFilterRange(filter: string, start?: string, end?: string, requestId?: string) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (filter) {
    case "today":
      return { start: today, end: new Date(today.getTime() + 24 * 60 * 60 * 1000) };
    case "yesterday": {
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      return { start: yesterday, end: new Date(yesterday.getTime() + 24 * 60 * 60 * 1000) };
    }
    case "this_week": {
      const dayOfWeek = today.getDay();
      const weekStart = new Date(today.getTime() - dayOfWeek * 24 * 60 * 60 * 1000);
      return { start: weekStart, end: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000) };
    }
    case "this_month": {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      return { start: monthStart, end: nextMonth };
    }
    case "custom":
      return { start: parseDate(start, requestId ?? ""), end: parseDate(end, requestId ?? "") };
    default:
      return undefined;
  }
}

function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (text.includes(",") || text.includes("\"") || text.includes("\n") || text.includes("\r")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rateLimit = checkRateLimit("companyadmin-employee-export", ip);
    if (!rateLimit.allowed) {
      return new Response("Rate limit exceeded", { status: 429 });
    }

    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      throw createCompanyAdminError(CompanyAdminErrorCode.PERMISSION_DENIED, "Authentication required.", 401, requestId);
    }

    const context = await resolveCompanyActorContext({ userId: actorUserIdFromSession(auth), requestId });
    ensureCompanyRole(context, ["admin", "manager"], requestId);
    ensureCompanyPermission(context, "manage_employees", requestId);

    const url = new URL(request.url);
    const status = normalizeStatus(url.searchParams.get("status"));
    const role = url.searchParams.get("role")?.trim().toLowerCase();
    const search = (url.searchParams.get("search") ?? "").trim();
    const filter = normalizeDateFilter(url.searchParams.get("date_filter"));
    const startDate = url.searchParams.get("start_date") ?? undefined;
    const endDate = url.searchParams.get("end_date") ?? undefined;
    const limit = parsePositiveInt(url.searchParams.get("limit"), 1000, 1, 5000);

    const where: any = {
      company_id: context.companyId,
      ...(status === "active" ? { is_active: true } : {}),
      ...(status === "restricted" ? { is_active: false } : {}),
      ...(role ? { role } : {}),
      ...(search
        ? {
            user: {
              OR: [
                { first_name: { contains: search, mode: "insensitive" } },
                { last_name: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    };

    if (filter !== "all") {
      const range = getFilterRange(filter, startDate, endDate, requestId);
      if (!range) {
        throw createCompanyAdminError(CompanyAdminErrorCode.INVALID_REQUEST, "Invalid date filter.", 400, requestId, { filter });
      }
      where.joined_at = { gte: range.start, lt: range.end };
    }

    const rows = await prisma.companyEmployee.findMany({
      where,
      include: {
        user: {
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            email: true,
            profile_url: true,
            userActivity: {
              select: { last_active: true },
            },
          },
        },
        activitySummaries: {
          where: { period: "all" },
          orderBy: { calculated_at: "desc" },
          take: 1,
        },
      },
      orderBy: { joined_at: "desc" },
      take: limit,
    });

    const header = [
      "Employee ID",
      "User ID",
      "Name",
      "Email",
      "Role",
      "Status",
      "Joined At",
      "Last Active",
      "Profile Views",
      "Contact Saves",
      "Inquiries",
      "Connections",
      "Rank Score",
    ];

    const lines = [header.join(",")];
    for (const row of rows) {
      const summary = row.activitySummaries[0];
      const name = `${row.user.first_name} ${row.user.last_name}`.trim();
      lines.push(
        [
          escapeCsv(row.employee_id.toString()),
          escapeCsv(row.user.user_id.toString()),
          escapeCsv(name),
          escapeCsv(row.user.email),
          escapeCsv(row.role),
          escapeCsv(row.is_active ? "active" : "restricted"),
          escapeCsv(row.joined_at.toISOString()),
          escapeCsv(row.user.userActivity?.last_active?.toISOString() ?? ""),
          escapeCsv(summary?.profile_views ?? 0),
          escapeCsv(summary?.contact_saves ?? 0),
          escapeCsv(summary?.inquiries_count ?? 0),
          escapeCsv(summary?.connections_count ?? 0),
          escapeCsv(summary ? Number(summary.rank_score).toFixed(2) : "0.00"),
        ].join(",")
      );
    }

    const csv = lines.join("\r\n");

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="company-${context.companyId.toString()}-employees.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/companyadmin/employees/export GET] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
