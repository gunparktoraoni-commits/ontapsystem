import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { CACHE_TTL, generateCacheKey, getCached } from "@/lib/cache";
import { actorUserIdFromSession, ensureCompanyRole,
  resolveCompanyActorContext, } from "@/server/lib/company";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rl = checkRateLimit("company-analytics-ranking", ip);
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

    const url = new URL(request.url);
    const period = (url.searchParams.get("period") ?? "all").toLowerCase();
    const limit = parsePositiveInt(url.searchParams.get("limit"), 20, 1, 100);

    const cacheKey = generateCacheKey(
      "company",
      context.companyId.toString(),
      "analytics",
      "ranking",
      period,
      limit
    );

    const { data, cached } = await getCached(
      cacheKey,
      async () => {
        const rows = await prisma.employeeActivitySummary.findMany({
          where: {
            employee: {
              company_id: context.companyId,
            },
            period,
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
                    profile_url: true,
                  },
                },
              },
            },
        },
          orderBy: [{ rank_score: "desc" }, { calculated_at: "desc" }],
          take: limit,
        });

        return {
          period,
          ranking: rows.map((row, index) => ({
            rank: index + 1,
            employee_id: row.employee_id.toString(),
            user_id: row.employee.user.user_id.toString(),
            name: `${row.employee.user.first_name} ${row.employee.user.last_name}`.trim(),
            profile_image: row.employee.user.profile_url,
            role: row.employee.role,
            is_active: row.employee.is_active,
            score: Number(row.rank_score),
            metrics: {
              profile_views: row.profile_views,
              contact_saves: row.contact_saves,
              inquiries_count: row.inquiries_count,
              connections_count: row.connections_count,
            },
            calculated_at: row.calculated_at,
          })),
        };
      },
      CACHE_TTL.COMPANY_ANALYTICS
    );

    const response = jsonSuccess(data, { requestId, responseTime: Date.now() - startedAt });
    response.headers.set("X-Cache", cached ? "HIT" : "MISS");
    return response;
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/analytics/ranking GET] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
