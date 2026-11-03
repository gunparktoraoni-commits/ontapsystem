import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withStaffPortal, checkStaffPortalRateLimit } from "@/lib/auth/staff-portal-middleware";
import {
  StaffMarketingErrorCode,
  createStaffMarketingError,
} from "@/lib/errors/staff-marketing-errors";
import { StaffMarketingService } from "@/lib/services/staff-marketing.service";

type RouteParams = {
  params: Promise<{ orderId: string }>;
};

const bodySchema = z.object({
  status: z.enum([
    "pending",
    "processed",
    "ready_for_pickup",
    "completed",
    "cancelled",
  ]),
  reason: z.string().max(500).optional(),
});

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  return withStaffPortal(async (context, request) => {
    const startTime = Date.now();
    await checkStaffPortalRateLimit("staff-portal-orders", request, context.requestId);

    const { orderId } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw createStaffMarketingError(
        StaffMarketingErrorCode.INVALID_FILTER_TYPE,
        "Invalid JSON body",
        400,
        context.requestId,
      );
    }

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      throw createStaffMarketingError(
        StaffMarketingErrorCode.INVALID_FILTER_TYPE,
        "Invalid request body",
        400,
        context.requestId,
        parsed.error.flatten(),
      );
    }

    const service = new StaffMarketingService(context.staffId, context.requestId);
    const order = await service.updateClientOrderStatus(
      orderId,
      parsed.data.status,
      parsed.data.reason,
    );

    return NextResponse.json({
      success: true,
      requestId: context.requestId,
      data: { order },
      meta: {
        requestId: context.requestId,
        responseTime: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      },
    });
  })(req);
}
