import ExcelJS from "exceljs";
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

type ExportFormat = "csv" | "xlsx";

const STATUS_FILTERS = new Set(["all", "pending", "active", "rejected", "restricted"]);
const SUBSCRIPTION_FILTERS = new Set(["all", "premium", "enterprise"]);
const MAX_EXPORT_ROWS = 25000;

function parseExportFormat(value: string | null, requestId: string): ExportFormat {
  const normalized = (value ?? "csv").trim().toLowerCase();
  if (normalized === "csv" || normalized === "xlsx") {
    return normalized;
  }

  throw createSuperAdminError(
    SuperAdminErrorCode.INVALID_FILTER,
    "Invalid format. Allowed: csv, xlsx",
    400,
    requestId,
    { format: normalized }
  );
}

function escapeCsv(value: unknown): string {
  const stringValue = value == null ? "" : String(value);
  if (stringValue.includes(",") || stringValue.includes("\"") || stringValue.includes("\n")) {
    return `"${stringValue.replace(/\"/g, '""')}"`;
  }
  return stringValue;
}

function toCsv(rows: Array<Record<string, unknown>>): Buffer {
  const headers = [
    "company_id",
    "company_name",
    "company_slug",
    "status",
    "subscription_tier",
    "current_employees",
    "max_employees",
    "approval_required",
    "email",
    "admin_name",
    "admin_email",
    "created_by_name",
    "created_by_email",
    "created_at",
    "approved_at",
  ];

  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      headers
        .map((header) => {
          const value = row[header];
          if (value instanceof Date) return escapeCsv(value.toISOString());
          return escapeCsv(value);
        })
        .join(",")
    );
  }

  return Buffer.from(`\uFEFF${lines.join("\n")}`, "utf8");
}

async function toXlsx(rows: Array<Record<string, unknown>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Companies");

  worksheet.columns = [
    { header: "Company ID", key: "company_id", width: 14 },
    { header: "Company Name", key: "company_name", width: 32 },
    { header: "Company Slug", key: "company_slug", width: 28 },
    { header: "Status", key: "status", width: 14 },
    { header: "Subscription Tier", key: "subscription_tier", width: 18 },
    { header: "Current Employees", key: "current_employees", width: 18 },
    { header: "Max Employees", key: "max_employees", width: 14 },
    { header: "Approval Required", key: "approval_required", width: 18 },
    { header: "Company Email", key: "email", width: 28 },
    { header: "Admin Name", key: "admin_name", width: 24 },
    { header: "Admin Email", key: "admin_email", width: 28 },
    { header: "Created By Name", key: "created_by_name", width: 24 },
    { header: "Created By Email", key: "created_by_email", width: 28 },
    { header: "Created At", key: "created_at", width: 26 },
    { header: "Approved At", key: "approved_at", width: 26 },
  ];

  for (const row of rows) {
    worksheet.addRow(row);
  }

  const fileBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(fileBuffer);
}

export const GET = withCompanySuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, originalUser } = context;

  try {
    const rateLimit = checkSuperadminCompanyRateLimit(req, "EXPORT", String(originalUser.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
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

    const rows = await prisma.company.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: MAX_EXPORT_ROWS,
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
        created_at: true,
        approved_at: true,
        createdByUser: {
          select: {
            first_name: true,
            last_name: true,
            email: true,
          },
        },
        admin: {
          select: {
            first_name: true,
            last_name: true,
            email: true,
          },
        },
      },
    });

    const exportRows = rows.map((row) => ({
      company_id: row.company_id.toString(),
      company_name: row.name,
      company_slug: row.company_slug ?? "",
      status: row.status,
      subscription_tier: row.subscription_tier ?? "",
      current_employees: row.current_employees,
      max_employees: row.max_employees ?? "",
      approval_required: row.approval_required ? "true" : "false",
      email: row.email ?? "",
      admin_name: row.admin ? `${row.admin.first_name} ${row.admin.last_name}`.trim() : "",
      admin_email: row.admin?.email ?? "",
      created_by_name: row.createdByUser
        ? `${row.createdByUser.first_name} ${row.createdByUser.last_name}`.trim()
        : "",
      created_by_email: row.createdByUser?.email ?? "",
      created_at: row.created_at,
      approved_at: row.approved_at,
    }));

    const fileBuffer = format === "xlsx" ? await toXlsx(exportRows) : toCsv(exportRows);
    const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const fileName = `companies_export_${dateStamp}.${format}`;

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
    return toSuperAdminErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to export companies"
    );
  }
});
