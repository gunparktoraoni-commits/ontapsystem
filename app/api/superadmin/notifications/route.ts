/**
 * GET  /api/superadmin/notifications
 *
 * Returns the latest in-app notifications for the authenticated superadmin.
 * Used by the notification bell in PortalHeader (polling every 10 s).
 *
 * Query params:
 *   limit  – number of records (default 20, max 50)
 *   unread – "true" to return only unread notifications
 *
 * Response:
 *   { success: true, data: { notifications, unread_count } }
 *
 * For `sa_new_user_registration` events, `message` and `metadata.account_mode`
 * are enriched from the user's live subscription / trial status (response only;
 * stored notification rows are not mutated).
 */

import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { prisma } from "@/server/lib/prisma";
import type { SuperAdminContext } from "@/lib/auth/superadmin-middleware";
import {
  SA_EVENT_NEW_USER_REGISTRATION,
  resolveAccountModesForUserIds,
} from "@/lib/services/superadmin-notifications.service";
import { resolveNotificationActionUrlForRole } from "@/server/lib/notifications";

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

export const GET = withDashboardSuperAdmin(async (req: NextRequest, context: SuperAdminContext) => {
  const startedAt = Date.now();
  const { user, requestId } = context;

  const url = new URL(req.url);
  const rawLimit = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(rawLimit ?? "20"), 1), 50);
  const page = Math.max(Number(url.searchParams.get("page") ?? "1"), 1);
  const offset = (page - 1) * limit;
  const unreadOnly = url.searchParams.get("unread") === "true";

  const where = {
    user_id: BigInt(user.id),
    is_archived: false,
    ...(unreadOnly ? { is_read: false } : {}),
  };

  const [notifications, unreadCount, total] = await Promise.all([
    prisma.userNotification.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        event_type: true,
        priority: true,
        title: true,
        message: true,
        metadata: true,
        action_url: true,
        action_text: true,
        is_read: true,
        created_at: true,
      },
    }),
    prisma.userNotification.count({
      where: {
        user_id: BigInt(user.id),
        is_read: false,
        is_archived: false,
      },
    }),
    prisma.userNotification.count({ where }),
  ]);

  const parsedRows = notifications.map((n) => {
    const metadata = parseMetadata(n.metadata);
    return {
      id: n.id,
      event_type: n.event_type,
      priority: n.priority,
      title: n.title,
      message: n.message,
      metadata,
      action_url: resolveNotificationActionUrlForRole(
        n.event_type,
        "super_admin",
        metadata,
        n.action_url ?? "",
      ),
      action_text: n.action_text,
      is_read: n.is_read,
      created_at: n.created_at.toISOString(),
    };
  });

  const registrationUserIds = parsedRows
    .filter((n) => n.event_type === SA_EVENT_NEW_USER_REGISTRATION)
    .map((n) => {
      const raw = n.metadata.new_user_id;
      return typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
    })
    .filter(Boolean);

  const accountModes =
    registrationUserIds.length > 0
      ? await resolveAccountModesForUserIds(registrationUserIds)
      : new Map<string, string>();

  const mapped = parsedRows.map((n) => {
    if (n.event_type !== SA_EVENT_NEW_USER_REGISTRATION) return n;

    const rawId = n.metadata.new_user_id;
    const userId =
      typeof rawId === "string" || typeof rawId === "number" ? String(rawId) : "";
    if (!userId) return n;

    const accountMode = accountModes.get(userId);
    if (!accountMode) return n;

    const fullNameRaw = n.metadata.full_name;
    const emailRaw = n.metadata.email;
    const fullName =
      (typeof fullNameRaw === "string" && fullNameRaw.trim()) ||
      (typeof emailRaw === "string" && emailRaw.trim()) ||
      "A user";

    return {
      ...n,
      message: `${fullName} (${accountMode}) just created an account.`,
      metadata: {
        ...n.metadata,
        account_mode: accountMode,
      },
    };
  });

  return NextResponse.json({
    success: true,
    data: {
      notifications: mapped,
      unread_count: unreadCount,
      hasMore: offset + notifications.length < total,
      pagination: {
        page,
        limit,
        total,
        hasMore: offset + notifications.length < total,
      },
    },
    meta: {
      requestId,
      responseTime: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
  });
});
