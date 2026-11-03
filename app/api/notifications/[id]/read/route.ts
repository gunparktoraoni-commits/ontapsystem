import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { requireNotificationSession } from "@/server/lib/notifications";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireNotificationSession(request);
  if (!auth.ok) return auth.response;

  const { id: notificationId } = await params;
  if (!notificationId) {
    return NextResponse.json({ error: "Notification ID is required." }, { status: 400 });
  }

  const updated = await prisma.userNotification.updateMany({
    where: {
      id: notificationId,
      user_id: auth.session.userId,
    },
    data: {
      is_read: true,
      read_at: new Date(),
      updated_at: new Date(),
    },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "Notification not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
