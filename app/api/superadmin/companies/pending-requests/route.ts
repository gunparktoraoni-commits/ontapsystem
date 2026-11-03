// app/api/superadmin/companies/pending-requests/route.ts
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

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export const GET = withCompanySuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkSuperadminCompanyRateLimit(req, "PENDING_REQUESTS", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many pending company request fetches. Please try again later.",
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
    const page = parsePositiveInt(params.get("page"), 1, 1, 10000);
    const limit = parsePositiveInt(params.get("limit"), 20, 1, 100);
    const rawSortBy = (params.get("sort_by") ?? "created_at").trim().toLowerCase();
    const rawSortDir = (params.get("sort_dir") ?? "asc").trim().toLowerCase();

    const allowedSortBy = new Set(["created_at", "company_name"]);
    if (!allowedSortBy.has(rawSortBy)) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_SORT_FIELD,
        "Invalid sort_by. Allowed: created_at, company_name",
        400,
        requestId,
        { sort_by: rawSortBy }
      );
    }

    const sortDir = rawSortDir === "desc" ? "desc" : rawSortDir === "asc" ? "asc" : null;
    if (!sortDir) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_SORT_FIELD,
        "Invalid sort_dir. Allowed: asc, desc",
        400,
        requestId,
        { sort_dir: rawSortDir }
      );
    }

    const skip = (page - 1) * limit;
    const orderBy =
      rawSortBy === "company_name"
        ? ({ name: sortDir } as const)
        : ({ created_at: sortDir } as const);

    const [items, total] = await Promise.all([
      prisma.company.findMany({
        where: { status: "pending" },
        orderBy,
        skip,
        take: limit,
        select: {
          company_id: true,
          name: true,
          description: true,
          subscription_tier: true,
          created_at: true,
          status: true,
          createdByUser: {
            select: {
              user_id: true,
              first_name: true,
              last_name: true,
              email: true,
              // removed marketplaceSubscription
            },
          },
        },
      }),
      prisma.company.count({ where: { status: "pending" } }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        requests: items.map((row) => ({
          request_id: row.company_id.toString(),
          company_name: row.name,
          description: row.description,
          subscription_tier: row.subscription_tier,
          created_by: row.createdByUser
            ? {
                user_id: row.createdByUser.user_id.toString(),
                name: `${row.createdByUser.first_name} ${row.createdByUser.last_name}`.trim(),
                email: row.createdByUser.email,
                // subscription omitted
              }
            : null,
          created_at: row.created_at,
          status: row.status,
        })),
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
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
      "Failed to fetch pending company requests"
    );
  }
});