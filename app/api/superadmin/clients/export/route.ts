import { NextRequest, NextResponse } from "next/server";
import { withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  ClientManagementService,
  type ExportFormat,
} from "@/lib/services/client-management.service";
import { checkClientRateLimit } from "@/lib/rate-limit/client-limits";
import { ClientErrorCode, createClientError, toClientErrorResponse } from "@/lib/errors/client-errors";
import { toClientErrorNextResponse } from "@/lib/errors/client-http";
import { type ClientDateFilter } from "@/lib/utils/client-management";

function parseExportFormat(value: string | null, requestId: string): ExportFormat {
  const normalized = (value ?? "csv").trim().toLowerCase();
  if (normalized === "csv" || normalized === "xlsx") {
    return normalized;
  }

  throw createClientError(
    ClientErrorCode.INVALID_PAGINATION,
    "Invalid format. Allowed: csv, xlsx",
    400,
    requestId,
    { format: normalized }
  );
}

function parseDateFilter(value: string | null, requestId: string): ClientDateFilter {
  const normalized = (value ?? "all").trim().toLowerCase();
  if (
    normalized === "all" ||
    normalized === "today" ||
    normalized === "this_week" ||
    normalized === "this_month" ||
    normalized === "last_month" ||
    normalized === "custom"
  ) {
    return normalized;
  }

  throw createClientError(
    ClientErrorCode.INVALID_PAGINATION,
    "Invalid date_filter. Allowed: all, today, this_week, this_month, last_month, custom",
    400,
    requestId,
    { date_filter: normalized }
  );
}

export const GET = withSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkClientRateLimit(req, "EXPORT", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toClientErrorResponse(
          ClientErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many export requests. Please try again later.",
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
    const format = parseExportFormat(params.get("format"), requestId);
    const search = params.get("search")?.trim() || undefined;
    const filter = params.get("filter")?.trim() || undefined;
    const clientName = params.get("client_name")?.trim() || undefined;
    const status = (params.get("status") ?? "all").toLowerCase();
    const subscriptionType = (params.get("subscription_type") ?? "all").toLowerCase();
    const dateFilter = parseDateFilter(params.get("date_filter"), requestId);
    const startDate = params.get("start_date") ?? undefined;
    const endDate = params.get("end_date") ?? undefined;

    const allowedStatus = new Set(["all", "active", "restricted"]);
    const allowedSubscription = new Set(["all", "free", "basic", "premium", "enterprise"]);

    if (!allowedStatus.has(status)) {
      throw createClientError(
        ClientErrorCode.INVALID_PAGINATION,
        "Invalid status. Allowed: all, active, restricted",
        400,
        requestId,
        { status }
      );
    }

    if (!allowedSubscription.has(subscriptionType)) {
      throw createClientError(
        ClientErrorCode.INVALID_PAGINATION,
        "Invalid subscription_type. Allowed: all, free, basic, premium, enterprise",
        400,
        requestId,
        { subscription_type: subscriptionType }
      );
    }

    const service = new ClientManagementService(requestId);
    const fileBuffer = await service.exportClients(
      {
        search,
        filter,
        client_name: clientName,
        status: status as "active" | "restricted" | "all",
        subscription_type: subscriptionType,
        date_filter: dateFilter,
        start_date: startDate,
        end_date: endDate,
      },
      format
    );

    const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const fileName = `clients_export_${dateStamp}.${format}`;

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        "Content-Type":
          format === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(fileBuffer.byteLength),
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    return toClientErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to export clients"
    );
  }
});
