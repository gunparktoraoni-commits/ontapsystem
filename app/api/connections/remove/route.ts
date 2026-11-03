import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  clearConnectionCachePrefix,
  requireConnectionsSession,
  touchUserActivity,
} from "@/server/lib/connections";

export async function DELETE(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("connections-remove", ip);
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

  let body: { connection_id?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.connection_id || !/^\d{1,20}$/.test(body.connection_id)) {
    return NextResponse.json({ error: "connection_id is required." }, { status: 400 });
  }

  const connectionId = BigInt(body.connection_id);
  const conn = await prisma.connection.findUnique({ where: { connect_id: connectionId } });
  if (!conn) return NextResponse.json({ error: "Connection not found." }, { status: 404 });

  if (conn.requester_user_id !== userId && conn.recipient_user_id !== userId) {
    return NextResponse.json({ error: "Not authorized to remove this connection." }, { status: 403 });
  }

  await prisma.connection.delete({ where: { connect_id: connectionId } });

  clearConnectionCachePrefix(`summary:${userId.toString()}:`);
  clearConnectionCachePrefix(`summary:${conn.requester_user_id.toString()}:`);
  clearConnectionCachePrefix(`summary:${conn.recipient_user_id.toString()}:`);
  clearConnectionCachePrefix(`list:${userId.toString()}:`);
  clearConnectionCachePrefix(`list:${conn.requester_user_id.toString()}:`);
  clearConnectionCachePrefix(`list:${conn.recipient_user_id.toString()}:`);

  return NextResponse.json(
    {
      success: true,
      message: "Connection removed successfully",
      removed_user_id:
        conn.requester_user_id === userId
          ? conn.recipient_user_id.toString()
          : conn.requester_user_id.toString(),
    },
    { status: 200 }
  );
}
