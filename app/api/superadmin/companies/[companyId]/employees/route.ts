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
import {
  countCoAdmins,
  DEFAULT_CO_ADMIN_PERMISSIONS,
  isCoAdminMember,
  MAX_CO_ADMINS,
  sanitizeCoAdminPermissions,
} from "@/server/lib/company";
import { isUserCurrentlyOnline } from "@/server/lib/user-presence";

type RouteContext = SuperAdminCompanyContext & {
  params: Promise<{ companyId: string }>;
};

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

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

export const GET = withCompanySuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, originalUser } = context;

  try {
    const rateLimit = checkSuperadminCompanyRateLimit(req, "EMPLOYEES_LIST", String(originalUser.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many employee list requests. Please try again later.",
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
        admin_id: true,
        created_by: true,
        admin: {
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            email: true,
          },
        },
        createdByUser: {
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

    const primaryAdminId = company.admin_id ?? company.created_by ?? null;
    const primaryUser = company.admin_id
      ? company.admin
      : company.created_by
        ? company.createdByUser
        : null;

    const params = req.nextUrl.searchParams;
    const page = parsePositiveInt(params.get("page"), 1, 1, 100000);
    const limit = parsePositiveInt(params.get("limit"), 20, 1, 100);
    const search = params.get("search")?.trim() || "";
    const rawStatus = (params.get("status") ?? "all").trim().toLowerCase();
    const rawSortBy = (params.get("sort_by") ?? "name").trim().toLowerCase();
    const rawSortDir = (params.get("sort_dir") ?? "asc").trim().toLowerCase();

    const allowedStatus = new Set(["all", "active", "restricted"]);
    const allowedSortBy = new Set(["name", "role", "joined_at", "rank_score"]);
    const allowedSortDir = new Set(["asc", "desc"]);

    if (!allowedStatus.has(rawStatus)) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        "Invalid status. Allowed: all, active, restricted",
        400,
        requestId,
        { status: rawStatus }
      );
    }

    if (!allowedSortBy.has(rawSortBy)) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_SORT_FIELD,
        "Invalid sort_by. Allowed: name, role, joined_at, rank_score",
        400,
        requestId,
        { sort_by: rawSortBy }
      );
    }

    if (!allowedSortDir.has(rawSortDir)) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_SORT_FIELD,
        "Invalid sort_dir. Allowed: asc, desc",
        400,
        requestId,
        { sort_dir: rawSortDir }
      );
    }

    const skip = (page - 1) * limit;
    const sortDir = rawSortDir as "asc" | "desc";

    const where = {
      company_id: company.company_id,
      ...(rawStatus === "active" ? { is_active: true } : {}),
      ...(rawStatus === "restricted" ? { is_active: false } : {}),
      ...(search
        ? {
            user: {
              OR: [
                { first_name: { contains: search } },
                { last_name: { contains: search } },
                { email: { contains: search } },
              ],
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.companyEmployee.findMany({
        where,
        include: {
          user: {
            select: {
              user_id: true,
              first_name: true,
              last_name: true,
              email: true,
              profile_url: true,
              is_online: true,
              last_active: true,
              userActivity: {
                select: { last_active: true },
              },
              _count: {
                select: {
                  userNotifications: {
                    where: { is_read: false },
                  },
                },
              },
            },
          },
          activitySummaries: {
            where: { period: "all" },
            orderBy: { calculated_at: "desc" },
            take: 1,
          },
        },
        orderBy:
          rawSortBy === "role"
            ? { role: sortDir }
            : rawSortBy === "joined_at"
              ? { joined_at: sortDir }
              : { joined_at: "asc" },
        skip,
        take: limit,
      }),
      prisma.companyEmployee.count({ where }),
    ]);

    const now = new Date();
    const items = rows.map((row) => {
      const summary = row.activitySummaries[0] ?? null;
      const rankScore = summary ? Number(summary.rank_score) : 0;
      const fullName = `${row.user.first_name} ${row.user.last_name}`.trim();
      const lastActive = row.user.last_active ?? row.user.userActivity?.last_active ?? null;
      const unreadCount = row.user._count.userNotifications;
      const isPrimaryAdmin =
        (company.admin_id != null && company.admin_id === row.user_id) ||
        (company.admin_id == null && company.created_by === row.user_id);
      const isCoAdmin = isCoAdminMember(row.role, row.user_id, primaryAdminId);
      const isOnline = isUserCurrentlyOnline({
        is_online: row.user.is_online,
        last_active: lastActive,
      }, now);

      let permissions: Record<string, boolean> | null = null;
      if (isPrimaryAdmin) {
        permissions = {
          manage_employees: true,
          view_analytics: true,
          edit_company: true,
          manage_inquiries: true,
        };
      } else if (isCoAdmin) {
        permissions = sanitizeCoAdminPermissions(
          row.permissions ? (() => {
            try {
              return JSON.parse(row.permissions) as unknown;
            } catch {
              return DEFAULT_CO_ADMIN_PERMISSIONS;
            }
          })() : DEFAULT_CO_ADMIN_PERMISSIONS,
        );
      }

      return {
        employee_id: row.employee_id.toString(),
        user: {
          user_id: row.user.user_id.toString(),
          name: fullName,
          email: row.user.email,
          profile_image: row.user.profile_url,
          role: row.role,
        },
        role: row.role,
        permissions,
        is_primary_admin: isPrimaryAdmin,
        is_co_admin: isCoAdmin,
        joined_at: row.joined_at,
        is_active: row.is_active,
        restricted_at: row.restricted_at,
        restricted_reason: row.restricted_reason,
        is_online: isOnline,
        last_active: lastActive,
        has_unread_messages: unreadCount > 0,
        unread_count: unreadCount,
        activity_summary: {
          profile_views: summary?.profile_views ?? 0,
          contact_saves: summary?.contact_saves ?? 0,
          inquiries: summary?.inquiries_count ?? 0,
          connections: summary?.connections_count ?? 0,
          rank_score: rankScore,
          rank: 0,
        },
      };
    });

    if (rawSortBy === "name") {
      items.sort((a, b) => (sortDir === "asc" ? a.user.name.localeCompare(b.user.name) : b.user.name.localeCompare(a.user.name)));
    }

    if (rawSortBy === "rank_score") {
      items.sort((a, b) =>
        sortDir === "asc"
          ? a.activity_summary.rank_score - b.activity_summary.rank_score
          : b.activity_summary.rank_score - a.activity_summary.rank_score
      );
    }

    items.forEach((item, idx) => {
      item.activity_summary.rank = idx + 1 + skip;
    });

    const topPerformer = [...items].sort((a, b) => b.activity_summary.rank_score - a.activity_summary.rank_score)[0] ?? null;
    const coAdminCount = await countCoAdmins(company.company_id, primaryAdminId);

    return NextResponse.json({
      success: true,
      data: {
        company: {
          company_id: company.company_id.toString(),
          company_name: company.name,
          primary_admin: primaryUser
            ? {
                user_id: primaryUser.user_id.toString(),
                name: `${primaryUser.first_name} ${primaryUser.last_name}`.trim(),
                email: primaryUser.email,
              }
            : null,
          co_admin_count: coAdminCount,
          co_admin_limit: MAX_CO_ADMINS,
        },
        employees: items,
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
        },
        summary: {
          total_employees: total,
          active_employees: items.filter((it) => it.is_active).length,
          restricted_employees: items.filter((it) => !it.is_active).length,
          online_now: items.filter((it) => it.is_online).length,
          co_admin_count: coAdminCount,
          co_admin_limit: MAX_CO_ADMINS,
          top_performer: topPerformer
            ? {
                name: topPerformer.user.name,
                rank_score: topPerformer.activity_summary.rank_score,
              }
            : null,
        },
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
      "Failed to fetch company employees"
    );
  }
});
