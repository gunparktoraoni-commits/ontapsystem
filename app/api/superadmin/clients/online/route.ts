import { NextRequest, NextResponse } from "next/server";
import { withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { ClientManagementService } from "@/lib/services/client-management.service";
import { checkClientRateLimit } from "@/lib/rate-limit/client-limits";
import { ClientErrorCode, createClientError, toClientErrorResponse } from "@/lib/errors/client-errors";
import { toClientErrorNextResponse } from "@/lib/errors/client-http";

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export const GET = withSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkClientRateLimit(req, "ONLINE", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toClientErrorResponse(
          ClientErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many online client requests. Please try again later.",
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
    const limit = parsePositiveInt(params.get("limit"), 15, 1, 50);

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

    const service = new ClientManagementService(requestId);
    const result = await service.getOnlineClients({
      page,
      limit,
      sort_by: "last_active",
      sort_dir: rawSortDir,
      status: "all",
    });

    return NextResponse.json({
      success: true,
      data: result,
      meta: {
        online_cutoff_minutes: 5,
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
      "Failed to fetch online clients"
    );
  }
});
