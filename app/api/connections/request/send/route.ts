import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp } from "@/server/lib/auth";
import {
  clearConnectionCachePrefix,
  isBlockedEitherDirection,
  requireConnectionsSession,
  touchUserActivity,
} from "@/server/lib/connections";
import { createNotificationFromEvent } from "@/server/lib/notifications";
import { getUserDisplayName, logActivity } from "@/server/lib/activity";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("connections-request-send", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many connection requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const auth = await requireConnectionsSession(request);
  if (!auth.ok) return auth.response;

  const requesterId = BigInt(auth.session.userId);
  await touchUserActivity(request, requesterId, BigInt(auth.session.sessionId));

  let body: { receiver_id?: string; relationship_type?: string; message?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.receiver_id || !/^\d{1,20}$/.test(body.receiver_id)) {
    return NextResponse.json({ error: "receiver_id is required." }, { status: 400 });
  }

  const receiverId = BigInt(body.receiver_id);
  const relationshipType = body.relationship_type === "associate" ? "associate" : "friend";

  if (requesterId === receiverId) {
    return NextResponse.json({ error: "You cannot connect with yourself." }, { status: 422 });
  }

  const target = await prisma.user.findUnique({ where: { user_id: receiverId }, select: { user_id: true, is_active: true } });
  if (!target || !target.is_active) {
    return NextResponse.json({ error: "Target user not found." }, { status: 404 });
  }

  if (await isBlockedEitherDirection(requesterId, receiverId)) {
    return NextResponse.json({ error: "Connection request could not be sent." }, { status: 409 });
  }

  const existing = await prisma.connection.findFirst({
    where: {
      OR: [
        { requester_user_id: requesterId, recipient_user_id: receiverId },
        { requester_user_id: receiverId, recipient_user_id: requesterId },
      ],
    },
    select: { connect_id: true, status: true },
  });

  if (existing && existing.status === "pending") {
    return NextResponse.json({ error: "A request is already pending." }, { status: 409 });
  }
  if (existing && existing.status === "accepted") {
    return NextResponse.json({ error: "You are already connected." }, { status: 409 });
  }

  const connection = existing
    ? await prisma.connection.update({
        where: { connect_id: existing.connect_id },
        data: {
          requester_user_id: requesterId,
          recipient_user_id: receiverId,
          relationship_type: relationshipType,
          status: "pending",
          updated_at: new Date(),
        },
      })
    : await prisma.connection.create({
        data: {
          requester_user_id: requesterId,
          recipient_user_id: receiverId,
          relationship_type: relationshipType,
          status: "pending",
        },
      });

  clearConnectionCachePrefix(`summary:${requesterId.toString()}:`);
  clearConnectionCachePrefix(`summary:${receiverId.toString()}:`);
  clearConnectionCachePrefix(`list:${requesterId.toString()}:`);
  clearConnectionCachePrefix(`list:${receiverId.toString()}:`);

  void getUserDisplayName(requesterId).then((requesterName) => {
    void logActivity(
      Number(receiverId),
      "NEW_CONNECTION",
      connection.connect_id,
      { relationshipType, fromName: requesterName },
    );
  });
  void getUserDisplayName(receiverId).then((recipientName) => {
    void logActivity(
      Number(requesterId),
      "CONNECTION_SENT",
      connection.connect_id,
      { relationshipType, targetName: recipientName },
    );
  });

  void createNotificationFromEvent({
    targetUserId: receiverId,
    triggerUserId: requesterId,
    eventType: "friend_request_sent",
    priority: "critical",
    metadata: {
      relationship_type: relationshipType,
      request_id: connection.connect_id.toString(),
    },
    needsEmail: true,
    emailPriority: "immediate",
  }).catch((error) => {
    console.error("[connections/request/send] notification dispatch failed:", error);
  });

  return NextResponse.json(
    serialize({
      success: true,
      request: {
        id: connection.connect_id,
        sender_id: requesterId,
        receiver_id: receiverId,
        status: "pending",
        relationship_type: relationshipType,
        message: body.message ?? null,
        created_at: connection.created_at,
      },
      message: "Connection request sent successfully",
    }),
    { status: 201 }
  );
}
