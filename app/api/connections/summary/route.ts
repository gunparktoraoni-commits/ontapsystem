import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  CONNECTION_CACHE_TTL,
  getCached,
  getMutualConnectionCounts,
  nowMinusOnlineWindow,
  requireConnectionsSession,
  setCached,
  touchUserActivity,
} from "@/server/lib/connections";
import { getClientIp } from "@/server/lib/auth";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("connections-summary", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const auth = await requireConnectionsSession(request);
  if (!auth.ok) return auth.response;

  const userId = BigInt(auth.session.userId);
  await touchUserActivity(request, userId, BigInt(auth.session.sessionId));

  const requestedUser = request.nextUrl.searchParams.get("userId");
  const includeDetails = request.nextUrl.searchParams.get("includeDetails") === "true";

  if (requestedUser && requestedUser !== String(auth.session.userId)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const cacheKey = `connections:summary:${auth.session.userId}:${includeDetails}`;
  const cached = getCached<Record<string, unknown>>(cacheKey);
  if (cached) {
    return NextResponse.json({ success: true, data: cached, cached: true });
  }

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const onlineCutoff = nowMinusOnlineWindow();

  const [acceptedRows, pendingReceived, pendingSent] = await Promise.all([
    prisma.connection.findMany({
      where: {
        status: "accepted",
        OR: [{ requester_user_id: userId }, { recipient_user_id: userId }],
      },
      select: {
        requester_user_id: true,
        recipient_user_id: true,
        created_at: true,
      },
    }),
    prisma.connection.count({ where: { recipient_user_id: userId, status: "pending" } }),
    prisma.connection.count({ where: { requester_user_id: userId, status: "pending" } }),
  ]);

  const connectionIds = acceptedRows.map((row) =>
    row.requester_user_id === userId ? row.recipient_user_id : row.requester_user_id
  );

  const onlineNow = connectionIds.length
    ? await prisma.userActivity.count({
        where: { user_id: { in: connectionIds }, last_active: { gte: onlineCutoff } },
      })
    : 0;

  const recentlyAdded = acceptedRows.filter((row) => row.created_at >= weekAgo).length;

  let mutualConnections = 0;
  if (includeDetails && connectionIds.length) {
    const counts = await getMutualConnectionCounts(userId, connectionIds);
    mutualConnections = counts.size;
  }

  const data = {
    total_connections: connectionIds.length,
    online_now: onlineNow,
    pending_requests_received: pendingReceived,
    pending_requests_sent: pendingSent,
    total_friends: connectionIds.length,
    recently_added: recentlyAdded,
    birthdays_today: 0,
    mutual_connections: includeDetails ? mutualConnections : undefined,
  };

  setCached(cacheKey, data, CONNECTION_CACHE_TTL.SUMMARY_MS);

  return NextResponse.json(serialize({ success: true, data }), { status: 200 });
}
