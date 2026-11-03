import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import {
  requireNotificationSession,
  resolveNotificationActionUrlForRole,
} from "@/server/lib/notifications";
import { serialize } from "../user/bizcards/_helpers";

function parseNotificationMetadata(raw: string | null) {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireNotificationSession(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "10"), 1), 100);
  const page = Math.max(Number(url.searchParams.get("page") ?? "1"), 1);
  const offset = (page - 1) * limit;
  const role = String(auth.session.role ?? "user");

  const where = {
    user_id: auth.session.userId,
    is_archived: false,
  } as const;

  const [notifications, total] = await Promise.all([
    prisma.userNotification.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.userNotification.count({ where }),
  ]);

  const data = {
    notifications: notifications.map((notification) => {
      const metadata = parseNotificationMetadata(notification.metadata);
      return {
        ...notification,
        metadata,
        action_url: resolveNotificationActionUrlForRole(
          notification.event_type,
          role,
          metadata,
          notification.action_url ?? "",
        ),
      };
    }),
    pagination: {
      page,
      limit,
      total,
      hasMore: offset + notifications.length < total,
    },
    hasMore: offset + notifications.length < total,
  };

  return NextResponse.json(serialize({ success: true, data }));
}
