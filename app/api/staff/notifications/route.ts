import { NextRequest, NextResponse } from "next/server";
import { withStaffPortal, checkStaffPortalRateLimit } from "@/lib/auth/staff-portal-middleware";
import { getStaffNotifications } from "@/lib/services/staff-notification.service";
import { serializeBigInts } from "@/server/lib/notifications";

export async function GET(req: NextRequest) {
  return withStaffPortal(async (context, request) => {
    await checkStaffPortalRateLimit("staff-portal-orders", request, context.requestId);

    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "10"), 1), 100);
    const page = Math.max(Number(url.searchParams.get("page") ?? "1"), 1);

    const notifications = await getStaffNotifications(context.user.userId, page, limit);

    return NextResponse.json(
      serializeBigInts({
        success: true,
        requestId: context.requestId,
        data: {
          notifications: notifications.notifications,
          hasMore: notifications.hasMore,
          pagination: {
            page: notifications.page,
            limit: notifications.limit,
            total: notifications.total,
            hasMore: notifications.hasMore,
          },
        },
      }),
    );
  })(req);
}
