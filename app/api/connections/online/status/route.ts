import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  CONNECTION_CACHE_TTL,
  asCursor,
  getAcceptedConnectionUserIds,
  getCached,
  nowMinusOnlineWindow,
  parsePositiveInt,
  requireConnectionsSession,
  setCached,
  touchUserActivity,
} from "@/server/lib/connections";

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("connections-online-status", ip);
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

  const q = request.nextUrl.searchParams;
  const limit = parsePositiveInt(q.get("limit"), 50, 200);
  const cursor = asCursor(q.get("cursor"));

  const cacheKey = `online:${userId.toString()}:${limit}:${cursor?.toString() ?? "none"}`;
  const cached = getCached<unknown>(cacheKey);
  if (cached) return NextResponse.json(cached, { status: 200 });

  const connectedIds = await getAcceptedConnectionUserIds(userId);
  if (connectedIds.length === 0) {
    return NextResponse.json(
      { success: true, users: [], pagination: { next_cursor: null, has_more: false } },
      { status: 200 }
    );
  }

  const rows = await prisma.userActivity.findMany({
    where: {
      user_id: {
        in: connectedIds,
        ...(cursor ? { gt: cursor } : {}),
      },
      last_active: {
        gte: nowMinusOnlineWindow(),
      },
    },
    include: {
      user: {
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
          profile_url: true,
          custom_uri: true,
        },
      },
    },
    orderBy: { user_id: "asc" },
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const response = {
    success: true,
    users: pageRows.map((r) => ({
      user_id: r.user_id.toString(),
      name: `${r.user.first_name} ${r.user.last_name}`.trim(),
      profile_image: r.user.profile_url,
      profile_uri: r.user.custom_uri,
      is_online: true,
      last_active: r.last_active,
    })),
    pagination: {
      next_cursor: hasMore ? pageRows[pageRows.length - 1].user_id.toString() : null,
      has_more: hasMore,
    },
  };

  setCached(cacheKey, response, CONNECTION_CACHE_TTL.ONLINE_MS);
  return NextResponse.json(response, { status: 200 });
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("connections-online-status", ip);
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

  const payload = await request.json().catch(() => null);
  if (!payload || !Array.isArray(payload.user_ids)) {
    return NextResponse.json({ error: "Invalid payload. Expected { user_ids: string[] }." }, { status: 400 });
  }

  const userIds: bigint[] = payload.user_ids
    .map((value: unknown) => {
      if (typeof value !== "string" && typeof value !== "number") return null;
      try {
        return BigInt(String(value));
      } catch {
        return null;
      }
    })
    .filter((value: bigint | null): value is bigint => value !== null);

  if (userIds.length === 0 || userIds.length > 200) {
    return NextResponse.json({ error: "Please provide between 1 and 200 user_ids." }, { status: 400 });
  }

  const connectedIds = await getAcceptedConnectionUserIds(userId);
  const allowedIds = userIds.filter((id) => connectedIds.some((connected) => connected === id));

  const rows = allowedIds.length
    ? await prisma.userActivity.findMany({
        where: { user_id: { in: allowedIds } },
        select: { user_id: true, last_active: true },
      })
    : [];

  const activityById = new Map(rows.map((row) => [row.user_id.toString(), row]));
  const onlineCutoff = nowMinusOnlineWindow();

  return NextResponse.json(
    {
      success: true,
      statuses: userIds.map((id) => {
        const row = activityById.get(id.toString());
        const lastActive = row?.last_active ?? null;
        return {
          user_id: id.toString(),
          is_online: Boolean(lastActive && lastActive >= onlineCutoff),
          last_active: lastActive,
        };
      }),
    },
    { status: 200 }
  );
}
