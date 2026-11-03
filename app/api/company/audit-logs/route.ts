import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { actorUserIdFromSession, ensurePrimaryAdmin,
  isCoAdminMember,
  resolveCompanyActorContext, } from "@/server/lib/company";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function parseOptionalBigInt(value: string | null, requestId: string): bigint | null {
  if (!value) return null;
  if (!/^\d+$/.test(value)) {
    throw createCompanyError(CompanyErrorCode.INVALID_EMPLOYEE_DATA, "Invalid user_id filter.", 400, requestId);
  }
  return BigInt(value);
}

function parseOptionalDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rl = checkRateLimit("company-audit-logs", ip);
    if (!rl.allowed) {
      throw createCompanyError(
        CompanyErrorCode.RATE_LIMIT_EXCEEDED,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) },
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
    ensurePrimaryAdmin(context, requestId);

    const { searchParams } = new URL(request.url);
    const page = parsePositiveInt(searchParams.get("page"), 1, 1000);
    const limit = parsePositiveInt(searchParams.get("limit"), 20, 100);
    const actionFilter = searchParams.get("action")?.trim() || null;
    const userIdFilter = parseOptionalBigInt(searchParams.get("user_id"), requestId);
    const from = parseOptionalDate(searchParams.get("from"));
    const to = parseOptionalDate(searchParams.get("to"));

    const company = await prisma.company.findUnique({
      where: { company_id: context.companyId },
      select: { admin_id: true, created_by: true },
    });

    const primaryAdminId = company?.admin_id ?? company?.created_by ?? null;

    const members = await prisma.companyEmployee.findMany({
      where: { company_id: context.companyId },
      select: { user_id: true, role: true },
    });

    const memberMap = new Map(
      members.map((member) => [member.user_id.toString(), member.role]),
    );
    if (primaryAdminId) {
      memberMap.set(primaryAdminId.toString(), "admin");
    }

    const memberUserIds = Array.from(memberMap.keys()).map((id) => BigInt(id));

    const where = {
      company_id: context.companyId,
      user_id: userIdFilter ? userIdFilter : { in: memberUserIds },
      ...(actionFilter ? { action: { contains: actionFilter } } : {}),
      NOT: { action: { startsWith: "superadmin." } },
      ...(from || to
        ? {
            created_at: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.companyAuditLog.count({ where }),
      prisma.companyAuditLog.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          log_id: true,
          user_id: true,
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

    return jsonSuccess(
      {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
        logs: rows.map((row) => {
          const role = memberMap.get(row.user_id.toString()) ?? "employee";
          return {
            log_id: row.log_id.toString(),
            user_id: row.user_id.toString(),
            actor_name: `${row.user.first_name} ${row.user.last_name}`.trim(),
            actor_email: row.user.email,
            role,
            is_co_admin: isCoAdminMember(role, row.user_id, primaryAdminId),
            action: row.action,
            details: safeParseDetails(row.details),
            request_id: row.request_id,
            created_at: row.created_at,
          };
        }),
      },
      { requestId, responseTime: Date.now() - startedAt },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/audit-logs GET] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
