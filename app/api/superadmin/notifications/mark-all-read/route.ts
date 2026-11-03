/**
 * POST /api/superadmin/notifications/mark-all-read
 *
 * Marks all unread notifications for the authenticated superadmin as read.
 *
 * Response: { success: true, data: { updated_count } }
 */

import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { prisma } from "@/server/lib/prisma";
import type { SuperAdminContext } from "@/lib/auth/superadmin-middleware";

export const POST = withDashboardSuperAdmin(async (_req: NextRequest, context: SuperAdminContext) => {
  const startedAt = Date.now();
  const { user, requestId } = context;

  const result = await prisma.userNotification.updateMany({
    where: {
      user_id: BigInt(user.id),
      is_read: false,
      is_archived: false,
    },
    data: {
      is_read: true,
      read_at: new Date(),
      updated_at: new Date(),
    },
  });

  return NextResponse.json({
    success: true,
    data: { updated_count: result.count },
    meta: {
      requestId,
      responseTime: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
  });
});
