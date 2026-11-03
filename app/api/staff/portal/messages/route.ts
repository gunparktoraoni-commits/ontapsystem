import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withStaffPortal, checkStaffPortalRateLimit } from "@/lib/auth/staff-portal-middleware";
import { StaffMarketingService } from "@/lib/services/staff-marketing.service";

const querySchema = z.object({
  page: z.string().optional().transform((v) => (v ? parseInt(v, 10) : undefined)),
  limit: z.string().optional().transform((v) => (v ? parseInt(v, 10) : undefined)),
  search: z.string().optional(),
});

export async function GET(req: NextRequest) {
  return withStaffPortal(async (context, request) => {
    const startTime = Date.now();
    await checkStaffPortalRateLimit("staff-portal-messages", request, context.requestId);

    const params = querySchema.parse({
      page: request.nextUrl.searchParams.get("page") || undefined,
      limit: request.nextUrl.searchParams.get("limit") || undefined,
      search: request.nextUrl.searchParams.get("search") || undefined,
    });

    const service = new StaffMarketingService(context.staffId, context.requestId);
    const result = await service.getMessagingClients(params);
    const responseTime = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      requestId: context.requestId,
      data: result,
      meta: {
        requestId: context.requestId,
        responseTime,
        timestamp: new Date().toISOString(),
      },
    });
  })(req);
}
