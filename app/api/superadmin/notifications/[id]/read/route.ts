/**
 * PATCH /api/superadmin/notifications/[id]/read
 *
 * Marks a single superadmin UserNotification as read.
 * Scoped to the authenticated superadmin — cannot mark another user's notification.
 *
 * Response: { success: true, data: { id, is_read } }
 */

import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { prisma } from "@/server/lib/prisma";
import type { SuperAdminContext } from "@/lib/auth/superadmin-middleware";

export const PATCH = withDashboardSuperAdmin(
  async (
    req: NextRequest,
    context: SuperAdminContext & { params: Promise<{ id: string }> },
  ) => {
    const startedAt = Date.now();
    const { user, requestId } = context;
    const { id } = await context.params;

    if (!id || typeof id !== "string" || id.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "Notification id is required." },
        { status: 400 },
      );
    }

    // Find and verify ownership before updating
    const notification = await prisma.userNotification.findFirst({
      where: {
        id,
        user_id: BigInt(user.id),
      },
      select: { id: true, is_read: true },
    });

    if (!notification) {
      return NextResponse.json(
        { success: false, error: "Notification not found." },
        { status: 404 },
      );
    }

    if (!notification.is_read) {
      await prisma.userNotification.update({
        where: { id },
        data: {
          is_read: true,
          read_at: new Date(),
          updated_at: new Date(),
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: { id, is_read: true },
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  },
);
