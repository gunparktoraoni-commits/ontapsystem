import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  clearConnectionCachePrefix,
  requireConnectionsSession,
  touchUserActivity,
} from "@/server/lib/connections";
import { createNotificationFromEvent } from "@/server/lib/notifications";
import { getUserDisplayName, logActivity } from "@/server/lib/activity";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("connections-request-respond", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const auth = await requireConnectionsSession(request);
  if (!auth.ok) return auth.response;

  const userId = BigInt(auth.session.userId);
  await touchUserActivity(request, userId, BigInt(auth.session.sessionId));

  let body: { request_id?: string; action?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.request_id || !/^\d{1,20}$/.test(body.request_id)) {
    return NextResponse.json({ error: "request_id is required." }, { status: 400 });
  }

  const requestId = BigInt(body.request_id);
  const action = (body.action ?? "").toLowerCase();
  if (!["accept", "decline", "block"].includes(action)) {
    return NextResponse.json({ error: "action must be accept, decline, or block." }, { status: 400 });
  }

  const conn = await prisma.connection.findUnique({ where: { connect_id: requestId } });
  if (!conn) return NextResponse.json({ error: "Connection request not found." }, { status: 404 });
  if (conn.recipient_user_id !== userId) {
    return NextResponse.json({ error: "Not authorized to respond to this request." }, { status: 403 });
  }
  if (conn.status !== "pending") {
    return NextResponse.json({ error: `Request already ${conn.status}.` }, { status: 409 });
  }

  const newStatus = action === "accept" ? "accepted" : action === "decline" ? "declined" : "blocked";

  const updated = await prisma.connection.update({
    where: { connect_id: requestId },
    data: { status: newStatus, updated_at: new Date() },
  });

  if (action === "block") {
    await prisma.blockedUser.upsert({
      where: {
        user_id_blocked_user_id: {
          user_id: userId,
          blocked_user_id: conn.requester_user_id,
        },
      },
      create: {
        user_id: userId,
        blocked_user_id: conn.requester_user_id,
        reason: "connection_request_block",
      },
      update: {},
    });
  }

  clearConnectionCachePrefix(`summary:${userId.toString()}:`);
  clearConnectionCachePrefix(`summary:${conn.requester_user_id.toString()}:`);
  clearConnectionCachePrefix(`list:${userId.toString()}:`);
  clearConnectionCachePrefix(`list:${conn.requester_user_id.toString()}:`);

  if (action === "accept") {
    void Promise.all([
      getUserDisplayName(userId).then((acceptorName) =>
        logActivity(
          Number(conn.requester_user_id),
          "CONNECTION_ACCEPTED",
          updated.connect_id,
          { targetName: acceptorName },
        ),
      ),
      getUserDisplayName(conn.requester_user_id).then((requesterName) =>
        logActivity(
          Number(userId),
          "CONNECTION_ACCEPTED",
          updated.connect_id,
          { targetName: requesterName },
        ),
      ),
    ]).catch(() => undefined);
    void Promise.all([
      createNotificationFromEvent({
        targetUserId: conn.requester_user_id,
        triggerUserId: userId,
        eventType: "friend_request_accepted",
        priority: "high",
        metadata: { request_id: updated.connect_id.toString() },
        needsEmail: true,
        emailPriority: "immediate",
      }),
      createNotificationFromEvent({
        targetUserId: conn.requester_user_id,
        triggerUserId: userId,
        eventType: "connection_added",
        priority: "high",
        metadata: { connection_id: updated.connect_id.toString() },
        needsEmail: false,
      }),
      createNotificationFromEvent({
        targetUserId: userId,
        triggerUserId: conn.requester_user_id,
        eventType: "connection_added",
        priority: "high",
        metadata: { connection_id: updated.connect_id.toString() },
        needsEmail: false,
      }),
    ]).catch((error) => {
      console.error("[connections/request/respond] notification dispatch failed:", error);
    });
  }

  const undoExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

  return NextResponse.json(
    serialize({
      success: true,
      request: {
        id: updated.connect_id,
        status: updated.status,
        responded_at: new Date(),
        undo_expires_at: undoExpiresAt,
      },
      message:
        action === "accept"
          ? "Connection request accepted"
          : action === "decline"
            ? "Connection request declined"
            : "User blocked successfully",
    }),
    { status: 200 }
  );
}
