import { NextRequest, NextResponse } from "next/server";
import { withCompanySuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  SuperAdminErrorCode,
  createSuperAdminError,
  toSuperAdminErrorResponse,
} from "@/lib/errors/superadmin-errors";
import { toSuperAdminErrorNextResponse } from "@/lib/errors/superadmin-http";
import { checkSuperadminCompanyRateLimit } from "@/lib/rate-limit/superadmin-company-limits";
import { prisma } from "@/server/lib/prisma";

const STATUS_FILTERS = new Set(["all", "pending", "active", "rejected", "restricted"]);
const SUBSCRIPTION_FILTERS = new Set(["all", "premium", "enterprise"]);
const SORT_FIELDS = new Set(["created_at", "company_name", "current_employees", "status"]);
const SORT_DIRECTIONS = new Set(["asc", "desc"]);

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
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

export const GET = withCompanySuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, originalUser } = context;

  try {
    const rateLimit = checkSuperadminCompanyRateLimit(req, "LIST", String(originalUser.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many company list requests. Please try again later.",
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

    const params = req.nextUrl.searchParams;
    const page = parsePositiveInt(params.get("page"), 1, 1, 100000);
    const limit = parsePositiveInt(params.get("limit"), 20, 1, 100);
    const search = params.get("search")?.trim() || undefined;

    const rawStatus = (params.get("status") ?? "all").trim().toLowerCase();
    if (!STATUS_FILTERS.has(rawStatus)) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        "Invalid status. Allowed: all, pending, active, rejected, restricted",
        400,
        requestId,
        { status: rawStatus }
      );
    }

    const rawSubscription = (params.get("subscription_tier") ?? "all").trim().toLowerCase();
    if (!SUBSCRIPTION_FILTERS.has(rawSubscription)) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        "Invalid subscription_tier. Allowed: all, premium, enterprise",
        400,
        requestId,
        { subscription_tier: rawSubscription }
      );
    }

    const rawSortBy = (params.get("sort_by") ?? "created_at").trim().toLowerCase();
    if (!SORT_FIELDS.has(rawSortBy)) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_SORT_FIELD,
        "Invalid sort_by. Allowed: created_at, company_name, current_employees, status",
        400,
        requestId,
        { sort_by: rawSortBy }
      );
    }

    const rawSortDir = (params.get("sort_dir") ?? "desc").trim().toLowerCase();
    if (!SORT_DIRECTIONS.has(rawSortDir)) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_SORT_FIELD,
        "Invalid sort_dir. Allowed: asc, desc",
        400,
        requestId,
        { sort_dir: rawSortDir }
      );
    }

    const skip = (page - 1) * limit;
    const where = {
      ...(rawStatus !== "all" ? { status: rawStatus } : {}),
      ...(rawSubscription !== "all" ? { subscription_tier: rawSubscription } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { email: { contains: search } },
              { company_slug: { contains: search } },
              { description: { contains: search } },
            ],
          }
        : {}),
    };

    const sortDir = rawSortDir as "asc" | "desc";
    const orderBy =
      rawSortBy === "company_name"
        ? ({ name: sortDir } as const)
        : rawSortBy === "current_employees"
          ? ({ current_employees: sortDir } as const)
          : rawSortBy === "status"
            ? ({ status: sortDir } as const)
            : ({ created_at: sortDir } as const);

    const [rows, total, pending, active, rejected, restricted] = await Promise.all([
      prisma.company.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          company_id: true,
          name: true,
          company_slug: true,
          status: true,
          subscription_tier: true,
          current_employees: true,
          max_employees: true,
          approval_required: true,
          email: true,
          logo_url: true,
          created_at: true,
          approved_at: true,
          createdByUser: {
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
          _count: {
            select: {
              companyEmployees: true,
              companyJoinRequests: true,
              companyNameChangeRequests: true,
            },
          },
        },
      }),
      prisma.company.count({ where }),
      prisma.company.count({ where: { status: "pending" } }),
      prisma.company.count({ where: { status: "active" } }),
      prisma.company.count({ where: { status: "rejected" } }),
      prisma.company.count({ where: { status: "restricted" } }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        companies: rows.map((row) => {
          const createdBy = toPerson(row.createdByUser);
          const primaryAdmin = toPerson(row.admin) ?? createdBy;
          return {
            company_id: row.company_id.toString(),
            company_name: row.name,
            company_slug: row.company_slug,
            status: row.status,
            subscription_tier: row.subscription_tier,
            current_employees: row.current_employees,
            max_employees: row.max_employees,
            approval_required: row.approval_required,
            email: row.email,
            logo_url: row.logo_url,
            created_at: row.created_at,
            approved_at: row.approved_at,
            created_by: createdBy,
            admin: primaryAdmin,
            counts: {
              employees: row._count.companyEmployees,
              join_requests: row._count.companyJoinRequests,
              name_change_requests: row._count.companyNameChangeRequests,
            },
          };
        }),
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
        },
        summary: {
          total_companies: total,
          status_breakdown: {
            pending,
            active,
            rejected,
            restricted,
          },
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
      "Failed to fetch companies"
    );
  }
});
