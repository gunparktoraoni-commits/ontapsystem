import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  CONNECTION_CACHE_TTL,
  getCached,
  requireConnectionsSession,
  setCached,
  touchUserActivity,
} from "@/server/lib/connections";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("connections-filter-options", ip);
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

  const cacheKey = `filters:${userId.toString()}`;
  const cached = getCached<unknown>(cacheKey);
  if (cached) return NextResponse.json(cached, { status: 200 });

  const acceptedEdges = await prisma.connection.findMany({
    where: {
      status: "accepted",
      OR: [{ requester_user_id: userId }, { recipient_user_id: userId }],
    },
    select: {
      requester_user_id: true,
      recipient_user_id: true,
    },
  });

  const connectionIds = acceptedEdges.map((edge) =>
    edge.requester_user_id === userId ? edge.recipient_user_id : edge.requester_user_id
  );

  const tags = connectionIds.length
    ? await prisma.connectionTag.groupBy({
        by: ["tag"],
        where: { user_id: userId, connection_id: { in: connectionIds } },
        _count: { tag: true },
        orderBy: { tag: "asc" },
      })
    : [];

  const companyRows = connectionIds.length
    ? await prisma.user.findMany({
        where: { user_id: { in: connectionIds } },
        select: { company: { select: { name: true } } },
      })
    : [];

  const locationRows = connectionIds.length
    ? await prisma.address.findMany({
        where: { user_id: { in: connectionIds }, city: { not: null } },
        select: { city: true, region: true },
        distinct: ["city", "region"],
        orderBy: [{ city: "asc" }, { region: "asc" }],
      })
    : [];

  const relationshipTypes = [
    { value: "all", label: "All" },
    { value: "friend", label: "Friends" },
    { value: "associate", label: "Associates" },
  ];

  const sortOptions = [
    { value: "recent", label: "Most Recent" },
    { value: "name", label: "Name A-Z" },
    { value: "oldest", label: "Oldest" },
  ];

  const response = serialize({
    success: true,
    filters: {
      relationship_types: relationshipTypes,
      tags: tags.map((t) => ({ value: t.tag, count: t._count.tag })),
      statuses: ["online", "offline", "all"],
      business_categories: Array.from(
        new Set(companyRows.map((row) => row.company?.name).filter((name): name is string => Boolean(name)))
      ).sort(),
      locations: locationRows.map((row) => ({ city: row.city, region: row.region })),
      sort_options: sortOptions,
    },
  });

  setCached(cacheKey, response, CONNECTION_CACHE_TTL.FILTER_MS);
  return NextResponse.json(response, { status: 200 });
}
