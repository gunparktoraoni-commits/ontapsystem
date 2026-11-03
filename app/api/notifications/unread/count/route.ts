import { NextRequest, NextResponse } from "next/server";
import { getUnreadSummary, requireNotificationSession } from "@/server/lib/notifications";

export async function GET(request: NextRequest) {
  const auth = await requireNotificationSession(request);
  
  // If not authenticated (e.g., during signup flow), return zero counts
  // instead of 401. This allows the layout/components to safely poll
  // this endpoint without errors during auth flows.
  if (!auth.ok) {
    return NextResponse.json({
      success: true,
      data: {
        unreadCount: 0,
        highPriorityCount: 0,
      },
    });
  }

  const summary = await getUnreadSummary(BigInt(auth.session.userId));
  return NextResponse.json({
    success: true,
    data: {
      unreadCount: summary.unread_count,
      highPriorityCount: summary.by_priority.high ?? 0,
    },
  });
}
