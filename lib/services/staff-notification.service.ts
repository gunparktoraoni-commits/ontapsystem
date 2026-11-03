import { prisma } from "@/server/lib/prisma";
import { resolveNotificationActionUrlForRole } from "@/server/lib/notifications";

export const STAFF_NOTIFICATION_EVENT_TYPES = [
  "support_message_received",
  "support_escalated",
  "support_resolved",
  "inquiry_sent",
  "client_order_placed",
  "client_assigned",
  "product_inquiry_received",
] as const;

function parseNotificationMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function getStaffNotifications(
  userId: bigint,
  page: number,
  limit: number,
) {
  const skip = (page - 1) * limit;
  const where = {
    user_id: userId,
    is_archived: false,
    event_type: { in: [...STAFF_NOTIFICATION_EVENT_TYPES] },
  };

  const [notifications, total] = await Promise.all([
    prisma.userNotification.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: limit,
      skip,
    }),
    prisma.userNotification.count({ where }),
  ]);

  return {
    notifications: notifications.map((notification) => {
      const metadata = parseNotificationMetadata(notification.metadata);
      return {
        ...notification,
        metadata,
        action_url: resolveNotificationActionUrlForRole(
          notification.event_type,
          "staff",
          metadata,
          notification.action_url ?? "",
        ),
      };
    }),
    hasMore: skip + notifications.length < total,
    total,
    page,
    limit,
  };
}

export async function getStaffUnreadCount(userId: bigint): Promise<number> {
  return prisma.userNotification.count({
    where: {
      user_id: userId,
      is_read: false,
      is_archived: false,
      event_type: { in: [...STAFF_NOTIFICATION_EVENT_TYPES] },
    },
  });
}
