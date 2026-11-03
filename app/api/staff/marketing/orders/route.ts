import { NextRequest, NextResponse } from "next/server";
import { withMarketingStaff, checkStaffMarketingRateLimit } from "@/lib/auth/staff-marketing-middleware";
import { StaffMarketingService } from "@/lib/services/staff-marketing.service";
import { z } from "zod";

const GetOrdersQuerySchema = z.object({
  page: z.string().optional().transform((v) => (v ? parseInt(v, 10) : undefined)),
  limit: z.string().optional().transform((v) => (v ? parseInt(v, 10) : undefined)),
  status: z.enum(["all", "active", "inactive"]).optional(),
});

export async function GET(req: NextRequest) {
  return withMarketingStaff(async (context, request) => {
    const startTime = Date.now();

    try {
      // Check rate limit
      await checkStaffMarketingRateLimit("staff-marketing-orders", request, context.requestId);

      // Parse query parameters
      const searchParams = request.nextUrl.searchParams;
      const queryParams = GetOrdersQuerySchema.parse({
        page: searchParams.get("page") || undefined,
        limit: searchParams.get("limit") || undefined,
        status: searchParams.get("status") || undefined,
      });

      // Get client orders
      const service = new StaffMarketingService(context.staffId, context.requestId);
      const result = await service.getClientOrders({
        page: queryParams.page,
        limit: queryParams.limit,
      });

      const responseTime = Date.now() - startTime;

      return NextResponse.json(
        {
          success: true,
          requestId: context.requestId,
          data: result,
          meta: {
            requestId: context.requestId,
            responseTime,
            timestamp: new Date().toISOString(),
          },
        },
        { status: 200 }
      );
    } catch (error) {
      throw error;
    }
  })(req);
}
