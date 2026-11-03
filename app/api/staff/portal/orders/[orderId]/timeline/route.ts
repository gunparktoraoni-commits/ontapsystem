import { NextRequest, NextResponse } from "next/server";
import { withStaffPortal, checkStaffPortalRateLimit } from "@/lib/auth/staff-portal-middleware";
import {
  StaffMarketingErrorCode,
  createStaffMarketingError,
} from "@/lib/errors/staff-marketing-errors";
import { StaffMarketingService } from "@/lib/services/staff-marketing.service";

type RouteParams = {
  params: Promise<{ orderId: string }>;
};

export async function GET(req: NextRequest, { params }: RouteParams) {
  return withStaffPortal(async (context, request) => {
    const startTime = Date.now();
    await checkStaffPortalRateLimit("staff-portal-orders", request, context.requestId);

    const { orderId } = await params;
    if (!orderId?.trim()) {
      throw createStaffMarketingError(
        StaffMarketingErrorCode.INVALID_FILTER_TYPE,
        "Invalid order id",
        400,
        context.requestId,
      );
    }

    const service = new StaffMarketingService(context.staffId, context.requestId);
    const timeline = await service.getClientOrderTimeline(orderId);

    return NextResponse.json({
      success: true,
      requestId: context.requestId,
      data: timeline,
      meta: {
        requestId: context.requestId,
        responseTime: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      },
    });
  })(req);
}
