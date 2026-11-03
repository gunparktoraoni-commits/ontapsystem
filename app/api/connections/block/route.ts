import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  clearConnectionCachePrefix,
  requireConnectionsSession,
  touchUserActivity,
} from "@/server/lib/connections";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("connections-block", ip);
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

  let body: { user_id?: string; reason?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.user_id || !/^\d{1,20}$/.test(body.user_id)) {
    return NextResponse.json({ error: "user_id is required." }, { status: 400 });
  }

  const targetId = BigInt(body.user_id);
  if (targetId === userId) {
    return NextResponse.json({ error: "You cannot block yourself." }, { status: 422 });
  }

  await prisma.blockedUser.upsert({
    where: {
      user_id_blocked_user_id: {
        user_id: userId,
        blocked_user_id: targetId,
      },
    },
    create: {
      user_id: userId,
      blocked_user_id: targetId,
      reason: body.reason?.slice(0, 50) ?? "manual_block",
    },
    update: {
      reason: body.reason?.slice(0, 50) ?? "manual_block",
    },
  });

  await prisma.connection.updateMany({
    where: {
      OR: [
        { requester_user_id: userId, recipient_user_id: targetId },
        { requester_user_id: targetId, recipient_user_id: userId },
      ],
    },
    data: {
      status: "blocked",
      updated_at: new Date(),
    },
  });

  clearConnectionCachePrefix(`summary:${userId.toString()}:`);
  clearConnectionCachePrefix(`summary:${targetId.toString()}:`);
  clearConnectionCachePrefix(`list:${userId.toString()}:`);
  clearConnectionCachePrefix(`list:${targetId.toString()}:`);

  return NextResponse.json(
    {
      success: true,
      message: "User blocked successfully",
      blocked_user_id: targetId.toString(),
    },
    { status: 200 }
  );
}
