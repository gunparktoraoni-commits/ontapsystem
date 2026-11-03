import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { actorUserIdFromSession, ensureCompanyPermission, ensureCompanyRole, resolveCompanyActorContext } from "@/server/lib/company";
import { CompanyAdminErrorCode, createCompanyAdminError } from "@/lib/errors/company-admin-errors";

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeStatus(value: string | null): string {
  const normalized = (value ?? "pending").toLowerCase();
  if (normalized === "pending" || normalized === "accepted" || normalized === "declined" || normalized === "all") {
    return normalized;
  }
  return "pending";
}

function normalizeSortBy(value: string | null): string {
  const normalized = (value ?? "requested_at").toLowerCase();
  if (normalized === "requested_at" || normalized === "reviewed_at" || normalized === "status") {
    return normalized;
  }
  return "requested_at";
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rateLimit = checkRateLimit("companyadmin-join-requests-list", ip);
    if (!rateLimit.allowed) {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.RATE_LIMIT_EXCEEDED,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rateLimit.retryAfterMs / 1000) }
      );
    }

    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.PERMISSION_DENIED,
        "Authentication required.",
        401,
        requestId
      );
    }

    const context = await resolveCompanyActorContext({
      userId: actorUserIdFromSession(auth),
      requestId,
    });
    ensureCompanyRole(context, ["admin", "manager"], requestId);
    ensureCompanyPermission(context, "manage_employees", requestId);

    const url = new URL(request.url);
    const page = parsePositiveInt(url.searchParams.get("page"), 1, 1, 10000);
    const limit = parsePositiveInt(url.searchParams.get("limit"), 20, 1, 100);
    const status = normalizeStatus(url.searchParams.get("status"));
    const search = (url.searchParams.get("search") ?? "").trim();
    const sortBy = normalizeSortBy(url.searchParams.get("sort_by"));
    const sortDir = url.searchParams.get("sort_dir")?.toLowerCase() === "desc" ? "desc" : "asc";
    const skip = (page - 1) * limit;

    const where: any = {
      company_id: context.companyId,
      ...(status !== "all" ? { status } : {}),
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

    const [requests, total] = await Promise.all([
      prisma.companyJoinRequest.findMany({
        where,
        include: {
          user: {
            select: {
              user_id: true,
              first_name: true,
              last_name: true,
              email: true,
              profile_url: true,
            },
          },
          reviewer: {
            select: {
              user_id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
        },
        orderBy:
          sortBy === "reviewed_at"
            ? { reviewed_at: sortDir }
            : sortBy === "status"
            ? { status: sortDir }
            : { requested_at: sortDir },
        skip,
        take: limit,
      }),
      prisma.companyJoinRequest.count({ where }),
    ]);

    const items = requests.map((row) => ({
      request_id: row.request_id.toString(),
      status: row.status,
      requested_at: row.requested_at,
      reviewed_at: row.reviewed_at,
      user: {
        user_id: row.user.user_id.toString(),
        name: `${row.user.first_name} ${row.user.last_name}`.trim(),
        email: row.user.email,
        profile_image: row.user.profile_url,
      },
      reviewer: row.reviewer
        ? {
            user_id: row.reviewer.user_id.toString(),
            name: `${row.reviewer.first_name} ${row.reviewer.last_name}`.trim(),
            email: row.reviewer.email,
          }
        : null,
      rejection_reason: row.rejection_reason,
    }));

    return jsonSuccess(
      {
        requests: items,
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
        },
      },
      { requestId, responseTime: Date.now() - startedAt }
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/companyadmin/join-requests GET] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
