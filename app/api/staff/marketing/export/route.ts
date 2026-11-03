import { NextRequest, NextResponse } from "next/server";
import { withMarketingStaff, checkStaffMarketingRateLimit } from "@/lib/auth/staff-marketing-middleware";
import { StaffMarketingService } from "@/lib/services/staff-marketing.service";
import { z } from "zod";

const ExportQuerySchema = z.object({
  date_filter: z.enum(["today", "yesterday", "this_week", "this_month", "custom"]).optional(),
  custom_start_date: z.string().optional(),
  custom_end_date: z.string().optional(),
  format: z.enum(["csv", "json"]).optional().default("csv"),
});

export async function GET(req: NextRequest) {
  return withMarketingStaff(async (context, request) => {
    const startTime = Date.now();

    try {
      // Check rate limit
      await checkStaffMarketingRateLimit("staff-marketing-export", request, context.requestId);

      // Parse query parameters
      const searchParams = request.nextUrl.searchParams;
      const queryParams = ExportQuerySchema.parse({
        date_filter: searchParams.get("date_filter") || undefined,
        custom_start_date: searchParams.get("custom_start_date") || undefined,
        custom_end_date: searchParams.get("custom_end_date") || undefined,
        format: searchParams.get("format") || "csv",
      });

      // Generate export
      const service = new StaffMarketingService(context.staffId, context.requestId);
      const exportData = await service.exportClientsReport({
        dateFilter: queryParams.date_filter,
        customStartDate: queryParams.custom_start_date,
        customEndDate: queryParams.custom_end_date,
      });

      const responseTime = Date.now() - startTime;

      // Format as CSV
      if (queryParams.format === "csv") {
        const csvContent = [
          exportData.headers.join(","),
          ...exportData.rows.map((row) =>
            exportData.headers
              .map((header) => {
                const value = row[header];
                if (value === null || value === undefined) return "";
                const stringValue = String(value);
                if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
                  return `"${stringValue.replace(/"/g, '""')}"`;
                }
                return stringValue;
              })
              .join(",")
          ),
        ].join("\n");

        return new NextResponse(csvContent, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="clients-export-${Date.now()}.csv"`,
            "X-Request-Id": context.requestId,
            "X-Response-Time": String(responseTime),
          },
        }) as unknown as NextResponse<{ requestId: string }>;
      }

      // Format as JSON
      return NextResponse.json(
        {
          success: true,
          requestId: context.requestId,
          data: exportData,
          meta: {
            responseTime,
            timestamp: new Date().toISOString(),
          },
        },
        { status: 200 }
      ) as NextResponse<{ requestId: string }>;
    } catch (error) {
      throw error;
    }
  })(req);
}
