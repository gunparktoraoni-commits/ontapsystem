import { NextRequest, NextResponse } from "next/server";
import { withStaffPortal, checkStaffPortalRateLimit } from "@/lib/auth/staff-portal-middleware";
import { getStaffUnreadCount } from "@/lib/services/staff-notification.service";

export async function GET(req: NextRequest) {
  return withStaffPortal(async (context, request) => {
    await checkStaffPortalRateLimit("staff-portal-orders", request, context.requestId);

    const unreadCount = await getStaffUnreadCount(context.user.userId);

    return NextResponse.json({
      success: true,
      requestId: context.requestId,
      data: {
        unreadCount,
        highPriorityCount: 0,
      },
    });
  })(req);
}
