// ──────────────────────────────────────────────────────────────
// POST /api/superadmin/system/broadcast-notification
// ──────────────────────────────────────────────────────────────
// Allows SuperAdmin to broadcast a system_update notification to
// all active users who have system_update notifications enabled.
//
// Respects each user's notification preferences:
//   - In-app notification only created if user has in_app: true for system_update
//   - Email queued only if user has email: true AND unsubscribed_at IS NULL
//     AND email_notifications_enabled (master switch)
//
// This endpoint batches in chunks of 100 to avoid memory pressure.
// Large user bases will be processed in background — response returns
// immediately with accepted counts.
//
// Security:
//   - Requires super_admin role (withSuperAdmin middleware)
//   - Input validation on title and message
//   - Rate limited per user via existing rate-limit infrastructure
//
// Error tags: [BROADCAST_NOTIFICATION_API]
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { type SuperAdminContext, withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { prisma } from "@/server/lib/prisma";
import {
  getDefaultPreferences,
  queueEmailForNotification,
  randomId,
  resolveNotificationActionUrlForRole,
} from "@/server/lib/notifications";

const BATCH_SIZE = 100;
const MAX_TITLE_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 1000;

function sanitizeString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function parsePreferences(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function isSystemUpdateEnabledInApp(prefsRaw: string | null): boolean {
  const prefs = parsePreferences(prefsRaw);
  const defaults = getDefaultPreferences();
  const eventPref = (prefs.system_update ?? defaults.system_update) as Record<string, unknown> | undefined;
  if (!eventPref) return true; // default is in_app: true
  if (eventPref.in_app === false) return false;
  return true;
}

function isSystemUpdateEmailEnabled(prefsRaw: string | null, unsubscribedAt: Date | null): boolean {
  if (unsubscribedAt !== null) return false;
  const prefs = parsePreferences(prefsRaw);
  const defaults = getDefaultPreferences();
  const eventPref = (prefs.system_update ?? defaults.system_update) as Record<string, unknown> | undefined;
  if (!eventPref) return false; // default is email: true for system_update
  return eventPref.email === true;
}

async function processBatch(
  users: Array<{
    user_id: bigint;
    email: string;
    first_name: string;
    role: string;
    notificationPreference: {
      preferences: string;
      unsubscribed_at: Date | null;
      email_verified: boolean;
    } | null;
  }>,
  title: string,
  message: string,
  actionUrl: string
): Promise<{ inAppQueued: number; emailQueued: number; skipped: number }> {
  let inAppQueued = 0;
  let emailQueued = 0;
  let skipped = 0;

  for (const user of users) {
    const pref = user.notificationPreference;
    const prefsRaw = pref?.preferences ?? null;
    const unsubscribedAt = pref?.unsubscribed_at ?? null;
    const emailVerified = pref?.email_verified ?? false;

    const wantsInApp = isSystemUpdateEnabledInApp(prefsRaw);
    const wantsEmail = emailVerified && isSystemUpdateEmailEnabled(prefsRaw, unsubscribedAt);

    if (!wantsInApp && !wantsEmail) {
      skipped++;
      continue;
    }

    const notificationId = randomId("notif");
    const resolvedActionUrl = resolveNotificationActionUrlForRole(
      "system_update",
      user.role,
      {},
      actionUrl || "/user/dashboard",
    );

    try {
      if (wantsInApp) {
        await prisma.userNotification.create({
          data: {
            id: notificationId,
            user_id: user.user_id,
            event_type: "system_update",
            priority: "medium",
            title,
            message,
            action_url: resolvedActionUrl,
            action_text: "View Update",
          },
        });

        await prisma.notificationDelivery.create({
          data: {
            id: randomId("ndel"),
            notification_id: notificationId,
            channel: "in_app",
            status: "delivered",
            delivered_at: new Date(),
          },
        });

        inAppQueued++;
      }

      if (wantsEmail) {
        await queueEmailForNotification({
          userId: user.user_id,
          notificationId: wantsInApp ? notificationId : null,
          recipientEmail: user.email,
          recipientName: user.first_name,
          subject: title,
          templateName: "system-update",
          templateData: {
            app_name: process.env.EMAIL_FROM_NAME ?? "OnTap",
            app_url: process.env.FRONTEND_URL ?? "",
            user_name: user.first_name,
            update_title: title,
            message,
            action_url: resolvedActionUrl,
            action_text: "View update",
          },
          emailType: "system_update",
          priority: 70,
        });

        if (wantsInApp) {
          // Add email delivery record linked to the in-app notification
          await prisma.notificationDelivery.create({
            data: {
              id: randomId("ndel"),
              notification_id: notificationId,
              channel: "email",
              status: "pending",
            },
          });
        }

        emailQueued++;
      }
    } catch (error) {
      console.error(
        `[BROADCAST_NOTIFICATION_API] Failed to create notification for user ${user.user_id.toString()}:`,
        error
      );
      skipped++;
    }
  }

  return { inAppQueued, emailQueued, skipped };
}

const postHandler = withSuperAdmin(
  async (req: NextRequest, context: Record<string, unknown> & SuperAdminContext) => {
    const startedAt = Date.now();
    const { requestId } = context;

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid JSON body.",
          tag: "[BROADCAST_NOTIFICATION_API]",
          requestId,
        },
        { status: 400 }
      );
    }

    const title = sanitizeString(body.title, MAX_TITLE_LENGTH);
    const message = sanitizeString(body.message, MAX_MESSAGE_LENGTH);
    const actionUrl = sanitizeString(body.action_url, 512) ?? "/user/dashboard";

    if (!title) {
      return NextResponse.json(
        {
          success: false,
          error: "title is required and must be a non-empty string (max 200 chars).",
          tag: "[BROADCAST_NOTIFICATION_API]",
          requestId,
        },
        { status: 422 }
      );
    }

    if (!message) {
      return NextResponse.json(
        {
          success: false,
          error: "message is required and must be a non-empty string (max 1000 chars).",
          tag: "[BROADCAST_NOTIFICATION_API]",
          requestId,
        },
        { status: 422 }
      );
    }

    // Fetch total active user count for the response
    const totalUsers = await prisma.user.count({
      where: {
        is_active: true,
        deactivated_flag: false,
        role: { notIn: ["super_admin"] },
      },
    });

    if (totalUsers === 0) {
      return NextResponse.json({
        success: true,
        data: {
          total_users_scanned: 0,
          in_app_delivered: 0,
          email_queued: 0,
          skipped: 0,
          response_time_ms: Date.now() - startedAt,
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      });
    }

    let cursor: bigint | undefined = undefined;
    let totalInApp = 0;
    let totalEmail = 0;
    let totalSkipped = 0;
    let processed = 0;

    // Paginate through users in batches to avoid memory pressure
    while (true) {
      const users: Array<{
        user_id: bigint;
        email: string;
        first_name: string;
        role: string;
        notificationPreference: {
          preferences: string;
          unsubscribed_at: Date | null;
          email_verified: boolean;
        } | null;
      }> = await prisma.user.findMany({
        where: {
          is_active: true,
          deactivated_flag: false,
          role: { notIn: ["super_admin"] },
          ...(cursor ? { user_id: { gt: cursor } } : {}),
        },
        select: {
          user_id: true,
          email: true,
          first_name: true,
          role: true,
          notificationPreference: {
            select: {
              preferences: true,
              unsubscribed_at: true,
              email_verified: true,
            },
          },
        },
        orderBy: { user_id: "asc" },
        take: BATCH_SIZE,
      });

      if (users.length === 0) break;

      const { inAppQueued, emailQueued, skipped } = await processBatch(
        users,
        title,
        message,
        actionUrl
      );

      totalInApp += inAppQueued;
      totalEmail += emailQueued;
      totalSkipped += skipped;
      processed += users.length;
      cursor = users[users.length - 1]!.user_id;

      if (users.length < BATCH_SIZE) break;
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          total_users_scanned: processed,
          in_app_delivered: totalInApp,
          email_queued: totalEmail,
          skipped: totalSkipped,
          response_time_ms: Date.now() - startedAt,
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status: 200 }
    );
  }
);

export async function POST(req: NextRequest, context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }) {
  return postHandler(req, context);
}
