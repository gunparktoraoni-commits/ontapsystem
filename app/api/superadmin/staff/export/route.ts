import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withStaffMgmtSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { StaffManagementService } from "@/lib/services/staff-mgmt.service";
import { checkStaffMgmtRateLimit } from "@/lib/rate-limit/staff-mgmt-limits";
import {
  StaffMgmtErrorCode,
  createStaffMgmtError,
  toStaffMgmtErrorResponse,
} from "@/lib/errors/staff-mgmt-errors";
import { toStaffMgmtErrorNextResponse } from "@/lib/errors/staff-mgmt-http";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const exportQuerySchema = z
  .object({
    format: z.enum(["csv", "xlsx"]).default("csv"),
    filter: z.enum(["all", "specific"]).default("all"),
    staff_info: z.string().trim().min(1).max(255).optional(),
    role: z
      .enum(["all", "web_developer", "sales_rep", "admin", "support_agent", "analyst"])
      .default("all"),
    department: z.enum(["all", "web_dev", "sales", "admin", "support", "analytics"]).default("all"),
    date_filter: z.enum(["all", "today", "yesterday", "this_week", "this_month", "custom"]).default("all"),
    start_date: z.string().trim().regex(dateRegex).optional(),
    end_date: z.string().trim().regex(dateRegex).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.filter === "specific" && !value.staff_info) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "staff_info is required when filter is specific",
        path: ["staff_info"],
      });
    }

    if (value.date_filter === "custom" && (!value.start_date || !value.end_date)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "start_date and end_date are required for custom date_filter",
        path: ["date_filter"],
      });
    }
  });

function toOptionalString(value: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseQuery(req: NextRequest, requestId: string) {
  const result = exportQuerySchema.safeParse({
    format: toOptionalString(req.nextUrl.searchParams.get("format")) ?? "csv",
    filter: toOptionalString(req.nextUrl.searchParams.get("filter")) ?? "all",
    staff_info: toOptionalString(req.nextUrl.searchParams.get("staff_info")),
    role: toOptionalString(req.nextUrl.searchParams.get("role")) ?? "all",
    department: toOptionalString(req.nextUrl.searchParams.get("department")) ?? "all",
    date_filter: toOptionalString(req.nextUrl.searchParams.get("date_filter")) ?? "all",
    start_date: toOptionalString(req.nextUrl.searchParams.get("start_date")),
    end_date: toOptionalString(req.nextUrl.searchParams.get("end_date")),
  });

  if (!result.success) {
    throw createStaffMgmtError(
      StaffMgmtErrorCode.INVALID_FILTER_TYPE,
      "Invalid export query parameters",
      400,
      requestId,
      { issues: result.error.issues }
    );
  }

  return result.data;
}

const getHandler = withStaffMgmtSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkStaffMgmtRateLimit(req, "EXPORT", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toStaffMgmtErrorResponse(
          StaffMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many staff export requests. Please try again later.",
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

    const query = parseQuery(req, requestId);

    const service = new StaffManagementService(requestId);
    const fileBuffer = await service.exportStaffList(
      query.filter,
      query.staff_info,
      query.role === "all" ? undefined : query.role,
      query.date_filter,
      query.start_date,
      query.end_date,
      query.department === "all" ? undefined : query.department,
      query.format
    );

    const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const fileName = `staff_export_${dateStamp}.${query.format}`;

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        "Content-Type":
          query.format === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(fileBuffer.byteLength),
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    return toStaffMgmtErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to export staff"
    );
  }
});

export async function GET(
  req: NextRequest,
  context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }
): Promise<Response> {
  return getHandler(req, context);
}
