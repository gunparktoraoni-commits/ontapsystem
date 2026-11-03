import { NextRequest, NextResponse } from "next/server";
import { withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { ClientManagementService, type ClientListFilters } from "@/lib/services/client-management.service";
import { checkClientRateLimit } from "@/lib/rate-limit/client-limits";
import { ClientErrorCode, createClientError, toClientErrorResponse } from "@/lib/errors/client-errors";
import { toClientErrorNextResponse } from "@/lib/errors/client-http";

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseListFilters(req: NextRequest, requestId: string): ClientListFilters {
  const params = req.nextUrl.searchParams;
  const page = parsePositiveInt(params.get("page"), 1, 1, 100000);
  // Ceiling raised from 100 → 10000 so the Super Admin Users feature can
  // request the full client list in one call and search across all records.
  const limit = parsePositiveInt(params.get("limit"), 20, 1, 10000);
  const search = params.get("search")?.trim() || undefined;

  const rawStatus = (params.get("status") ?? "all").toLowerCase();
  if (rawStatus !== "all" && rawStatus !== "active" && rawStatus !== "restricted") {
    throw createClientError(
      ClientErrorCode.INVALID_PAGINATION,
      "Invalid status. Allowed: all, active, restricted",
      400,
      requestId,
      { status: rawStatus }
    );
  }

  const rawSubscription = (params.get("subscription_type") ?? "all").toLowerCase();
  const allowedSubscription = new Set(["all", "free", "basic", "premium", "enterprise"]);
  if (!allowedSubscription.has(rawSubscription)) {
    throw createClientError(
      ClientErrorCode.INVALID_PAGINATION,
      "Invalid subscription_type. Allowed: all, free, basic, premium, enterprise",
      400,
      requestId,
      { subscription_type: rawSubscription }
    );
  }

  const rawSortBy = (params.get("sort_by") ?? "created_at").toLowerCase();
  const sortBy = rawSortBy as ClientListFilters["sort_by"];
  if (sortBy !== "created_at" && sortBy !== "last_active" && sortBy !== "name" && sortBy !== "email") {
    throw createClientError(
      ClientErrorCode.INVALID_PAGINATION,
      "Invalid sort_by. Allowed: created_at, last_active, name, email",
      400,
      requestId,
      { sort_by: rawSortBy }
    );
  }

  const rawSortDir = (params.get("sort_dir") ?? "desc").toLowerCase();
  if (rawSortDir !== "asc" && rawSortDir !== "desc") {
    throw createClientError(
      ClientErrorCode.INVALID_PAGINATION,
      "Invalid sort_dir. Allowed: asc, desc",
      400,
      requestId,
      { sort_dir: rawSortDir }
    );
  }

  return {
    page,
    limit,
    search,
    status: rawStatus as ClientListFilters["status"],
    subscription_type: rawSubscription,
    sort_by: sortBy,
    sort_dir: rawSortDir as ClientListFilters["sort_dir"],
  };
}

export const GET = withSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkClientRateLimit(req, "LIST", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toClientErrorResponse(
          ClientErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many client list requests. Please try again later.",
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

    const filters = parseListFilters(req, requestId);
    const service = new ClientManagementService(requestId);
    const result = await service.getClients(filters);

    return NextResponse.json({
      success: true,
      data: result,
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return toClientErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to fetch clients"
    );
  }
});
