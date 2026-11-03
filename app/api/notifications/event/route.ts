import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp } from "@/server/lib/auth";
import {
  createNotificationFromEvent,
  isValidEventType,
  isValidPriority,
  serializeBigInts,
} from "@/server/lib/notifications";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = checkRateLimit("notification-event", ip);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many notification events." }, { status: 429 });
  }

  const internalToken = request.headers.get("x-internal-notification-token");
  if (!process.env.NOTIFICATION_INTERNAL_TOKEN || internalToken !== process.env.NOTIFICATION_INTERNAL_TOKEN) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: {
    trigger_user_id?: string;
    target_user_id?: string;
    event_type?: string;
    priority?: string;
    metadata?: Record<string, unknown>;
    needs_email?: boolean;
    email_priority?: string;
  } = {};

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.target_user_id || !/^\d{1,20}$/.test(body.target_user_id)) {
    return NextResponse.json({ error: "target_user_id is required." }, { status: 400 });
  }

  if (!body.event_type || !isValidEventType(body.event_type)) {
    return NextResponse.json({ error: "event_type is invalid." }, { status: 400 });
  }

  const targetUserId = BigInt(body.target_user_id);
  const triggerUserId = body.trigger_user_id && /^\d{1,20}$/.test(body.trigger_user_id) ? BigInt(body.trigger_user_id) : null;

  if (triggerUserId && triggerUserId === targetUserId) {
    return NextResponse.json({ error: "Self-target events are not allowed." }, { status: 422 });
  }

  const targetUser = await prisma.user.findUnique({
    where: { user_id: targetUserId },
    select: { user_id: true, is_active: true },
  });

  if (!targetUser || !targetUser.is_active) {
    return NextResponse.json({ error: "Target user not found." }, { status: 404 });
  }
  const created = await createNotificationFromEvent({
    targetUserId,
    triggerUserId,
    eventType: body.event_type,
    priority: typeof body.priority === "string" && isValidPriority(body.priority) ? body.priority : undefined,
    metadata: body.metadata ?? {},
    needsEmail: body.needs_email === true,
    emailPriority: body.email_priority === "immediate" || body.email_priority === "digest" || body.email_priority === "batch"
      ? body.email_priority
      : undefined,
  });

  if (!created.success && created.reason === "blocked") {
    return NextResponse.json({ error: "Notification suppressed by block rules." }, { status: 403 });
  }

  if (!created.success && created.reason === "suppressed_by_preferences") {
    return NextResponse.json(
      serializeBigInts({
        success: true,
        notification_id: null,
        queued_for_email: false,
        estimated_delivery: null,
        unread_count: created.unreadCount,
        user_preferences_respected: created.userPreferencesRespected,
      }),
      { status: 201 }
    );
  }

  return NextResponse.json(
    serializeBigInts({
      success: true,
      notification_id: created.notificationId,
      queued_for_email: created.queuedForEmail,
      estimated_delivery: body.email_priority === "immediate" ? new Date().toISOString() : null,
      unread_count: created.unreadCount,
      user_preferences_respected: created.userPreferencesRespected,
    }),
    { status: 201 }
  );
}
