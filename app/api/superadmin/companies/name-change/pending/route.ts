import { NextRequest, NextResponse } from "next/server";
import { withCompanySuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  SuperAdminErrorCode,
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
    const rateLimit = checkSuperadminCompanyRateLimit(req, "NAME_CHANGE_PENDING", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many pending name change fetches. Please try again later.",
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
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      prisma.companyNameChangeRequest.findMany({
        where: { status: "pending" },
        include: {
          company: {
            select: {
              company_id: true,
              name: true,
              company_slug: true,
            },
          },
          requester: {
            select: {
              user_id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
        },
        orderBy: { requested_at: "asc" },
        skip,
        take: limit,
      }),
      prisma.companyNameChangeRequest.count({ where: { status: "pending" } }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        requests: items.map((item) => ({
          request_id: item.request_id.toString(),
          company: {
            company_id: item.company.company_id.toString(),
            company_name: item.company.name,
            company_slug: item.company.company_slug,
          },
          requested_name: item.requested_name,
          requested_by: {
            user_id: item.requester.user_id.toString(),
            name: `${item.requester.first_name} ${item.requester.last_name}`.trim(),
            email: item.requester.email,
          },
          requested_at: item.requested_at,
          status: item.status,
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
      "Failed to fetch pending name change requests"
    );
  }
});
