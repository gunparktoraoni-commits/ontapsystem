import { NextRequest, NextResponse } from "next/server";
import { withMarketingStaff, checkStaffMarketingRateLimit } from "@/lib/auth/staff-marketing-middleware";
import { StaffMarketingService } from "@/lib/services/staff-marketing.service";

export async function GET(req: NextRequest) {
  return withMarketingStaff(async (context, request) => {
    const startTime = Date.now();

    try {
      // Check rate limit
      await checkStaffMarketingRateLimit(
        "staff-marketing-messaging-clients",
        request,
        context.requestId
      );

      // Get messaging clients
      const service = new StaffMarketingService(context.staffId, context.requestId);
      const clients = await service.getMessagingClients();

      const responseTime = Date.now() - startTime;

      return NextResponse.json(
        {
          success: true,
          requestId: context.requestId,
          data: clients,
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
