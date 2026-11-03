import { NextRequest, NextResponse } from "next/server";
import { getRequestId } from "@/lib/errors/http";
import { withStaffPortal, checkStaffPortalRateLimit } from "@/lib/auth/staff-portal-middleware";
import { SupportMessagingService } from "@/lib/services/support-messaging.service";
import { supportErrorResponse } from "@/lib/api/support-route-utils";

export async function GET(req: NextRequest) {
  return withStaffPortal(async (context, request) => {
    const requestId = context.requestId || getRequestId(request.headers);
    try {
      await checkStaffPortalRateLimit("staff-portal-support-read", request, requestId);
      const service = new SupportMessagingService();
      const conversations = await service.listStaffConversations(context.staffId);
      return NextResponse.json({ success: true, data: conversations, requestId });
    } catch (error) {
      return supportErrorResponse(error, requestId);
    }
  })(req);
}
