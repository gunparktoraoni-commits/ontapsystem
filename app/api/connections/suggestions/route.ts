import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  CONNECTION_CACHE_TTL,
  anonymizeEmail,
  getAcceptedConnectionUserIds,
  getCached,
  parsePositiveInt,
  requireConnectionsSession,
  setCached,
  touchUserActivity,
} from "@/server/lib/connections";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("connections-suggestions", ip);
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

  const limit = parsePositiveInt(request.nextUrl.searchParams.get("limit"), 10, 30);
  const cacheKey = `suggestions:${userId.toString()}:${limit}`;
  const cached = getCached<unknown>(cacheKey);
  if (cached) return NextResponse.json(cached, { status: 200 });

  const connected = await getAcceptedConnectionUserIds(userId);

  const blocked = await prisma.blockedUser.findMany({
    where: {
      OR: [{ user_id: userId }, { blocked_user_id: userId }],
    },
    select: {
      user_id: true,
      blocked_user_id: true,
    },
  });

  const blockedSet = new Set<string>();
  for (const row of blocked) {
    if (row.user_id === userId) blockedSet.add(row.blocked_user_id.toString());
    if (row.blocked_user_id === userId) blockedSet.add(row.user_id.toString());
  }

  const exclude = new Set<string>([userId.toString(), ...connected.map((x) => x.toString()), ...blockedSet]);

  const candidates = await prisma.user.findMany({
    where: {
      is_active: true,
      user_id: {
        notIn: Array.from(exclude).map((x) => BigInt(x)),
      },
    },
    select: {
      user_id: true,
      first_name: true,
      last_name: true,
      email: true,
      profile_url: true,
      job_position: true,
      company: { select: { name: true } },
      custom_uri: true,
    },
    orderBy: { created_at: "desc" },
    take: Math.max(limit * 2, 20),
  });

  const suggestions = candidates.slice(0, limit).map((u) => ({
    id: u.user_id.toString(),
    name: `${u.first_name} ${u.last_name}`.trim(),
    email: anonymizeEmail(u.email),
    profile_image: u.profile_url,
    title: u.job_position,
    business_name: u.company?.name ?? null,
    profile_uri: u.custom_uri,
    mutual_connections: 0,
    reason: "People you may know",
  }));

  const response = serialize({ success: true, suggestions, total: suggestions.length });
  setCached(cacheKey, response, CONNECTION_CACHE_TTL.SUGGESTIONS_MS);

  return NextResponse.json(response, { status: 200 });
}
