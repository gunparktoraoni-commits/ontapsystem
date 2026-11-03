import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { requireNotificationSession } from "@/server/lib/notifications";

export async function POST(request: NextRequest) {
  const auth = await requireNotificationSession(request);
  if (!auth.ok) return auth.response;

  await prisma.userNotification.updateMany({
    where: {
      user_id: auth.session.userId,
      is_read: false,
    },
    data: {
      is_read: true,
      read_at: new Date(),
      updated_at: new Date(),
    },
  });

  return NextResponse.json({ success: true });
}
