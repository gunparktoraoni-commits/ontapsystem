import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  CONNECTION_CACHE_TTL,
  anonymizeEmail,
  asCursor,
  formatTimeAgo,
  getCached,
  getMutualConnectionCounts,
  nowMinusOnlineWindow,
  parseBoolean,
  parsePositiveInt,
  requireConnectionsSession,
  setCached,
  touchUserActivity,
} from "@/server/lib/connections";
import { getClientIp } from "@/server/lib/auth";

const SORT_FIELDS = new Set(["name", "connection_date", "last_active", "mutual_connections"]);

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("connections-list", ip);
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
  const limit = parsePositiveInt(q.get("limit"), 20, 100);
  const page = parsePositiveInt(q.get("page"), 1);
  const cursor = asCursor(q.get("cursor"));
  const search = (q.get("search") ?? "").trim();
  const onlineOnly = parseBoolean(q.get("online_only"), false);
  const tag = (q.get("tag") ?? "").trim();
  const location = (q.get("location") ?? "").trim();
  const businessCategory = (q.get("business_category") ?? "").trim();
  const sortByRaw = (q.get("sort_by") ?? "name").toLowerCase();
  const sortBy = SORT_FIELDS.has(sortByRaw) ? sortByRaw : "name";
  const sortDir = (q.get("sort_dir") ?? "asc").toLowerCase() === "desc" ? "desc" : "asc";

  const cacheKey = `connections:list:${auth.session.userId}:${q.toString()}`;
  const cached = getCached<Record<string, unknown>>(cacheKey);
  if (cached) {
    return NextResponse.json(serialize({ success: true, ...cached, cached: true }), { status: 200 });
  }

  const onlineCutoff = nowMinusOnlineWindow();

  const otherUserFilter: any = {
    is_active: true,
    deactivated_flag: false,
  };

  if (search) {
    otherUserFilter.AND = [
      {
        OR: [
          { first_name: { contains: search, mode: "insensitive" } },
          { last_name: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { company: { name: { contains: search, mode: "insensitive" } } },
          { job_position: { contains: search, mode: "insensitive" } },
          { addresses: { some: { city: { contains: search, mode: "insensitive" } } } },
        ],
      },
    ];
  }

  if (onlineOnly) {
    otherUserFilter.userActivity = { last_active: { gte: onlineCutoff } };
  }

  if (tag) {
    otherUserFilter.connectionTagsTarget = {
      some: { user_id: userId, tag: { equals: tag, mode: "insensitive" } },
    };
  }

  if (location) {
    otherUserFilter.OR = [
      ...(otherUserFilter.OR ?? []),
      { addresses: { some: { city: { contains: location, mode: "insensitive" } } } },
      { addresses: { some: { region: { contains: location, mode: "insensitive" } } } },
    ];
  }

  if (businessCategory) {
    otherUserFilter.company = { name: { contains: businessCategory, mode: "insensitive" } };
  }

  const connectionWhere = {
    status: "accepted",
    OR: [
      {
        requester_user_id: userId,
        recipient: otherUserFilter,
      },
      {
        recipient_user_id: userId,
        requester: otherUserFilter,
      },
    ],
    ...(cursor ? { connect_id: { lt: cursor } } : {}),
  };

  const connectionEdges = await prisma.connection.findMany({
    where: connectionWhere,
    take: 1000,
    orderBy: { connect_id: "desc" },
    select: {
      connect_id: true,
      created_at: true,
      requester_user_id: true,
      recipient_user_id: true,
      requester: {
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
          email: true,
          profile_url: true,
          cover_url: true,
          role: true,
          custom_uri: true,
          job_position: true,
          bizcards: {
            where: { deactivated_flag: false, is_blank: false },
            orderBy: { updated_at: "desc" },
            take: 1,
            select: { url_alias: true, portfolio_url: true, profile_img: true, cover_img: true },
          },
          addresses: { select: { city: true }, take: 1 },
          userActivity: { select: { last_active: true } },
          company: { select: { name: true } },
          connectionTagsTarget: { where: { user_id: userId }, select: { tag: true } },
        },
      },
      recipient: {
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
          email: true,
          profile_url: true,
          cover_url: true,
          role: true,
          custom_uri: true,
          job_position: true,
          bizcards: {
            where: { deactivated_flag: false, is_blank: false },
            orderBy: { updated_at: "desc" },
            take: 1,
            select: { url_alias: true, portfolio_url: true, profile_img: true, cover_img: true },
          },
          addresses: { select: { city: true }, take: 1 },
          userActivity: { select: { last_active: true } },
          company: { select: { name: true } },
          connectionTagsTarget: { where: { user_id: userId }, select: { tag: true } },
        },
      },
    },
  });

  const rows = connectionEdges
    .map((edge) => {
      const other = edge.requester_user_id === userId ? edge.recipient : edge.requester;
      if (!other) return null;
      const card = other.bizcards[0];
      const alias = card?.url_alias || other.custom_uri;
      return {
        connectionId: edge.connect_id.toString(),
        id: other.user_id.toString(),
        name: `${other.first_name} ${other.last_name}`.trim(),
        email: anonymizeEmail(other.email),
        // User profile_url is authoritative; bizcard images can be stale/unservable.
        profile_image: other.profile_url || card?.profile_img,
        cover_image: other.cover_url || card?.cover_img,
        role: other.role,
        portfolio_url:
          card?.portfolio_url ||
          (alias ? `/${encodeURIComponent(alias)}` : null),
        business_name: other.company?.name ?? null,
        position: other.job_position,
        connection_date: edge.created_at,
        last_active: other.userActivity?.last_active ?? null,
        online_status: Boolean(other.userActivity?.last_active && other.userActivity.last_active >= onlineCutoff),
        tags: other.connectionTagsTarget.map((tagRow) => tagRow.tag),
        notes: null,
        location: other.addresses[0]?.city ?? null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const userIds = rows.map((row) => BigInt(row.id));
  const mutualCounts = userIds.length ? await getMutualConnectionCounts(userId, userIds) : new Map();

  const enriched = rows.map((row) => ({
    ...row,
    mutual_connections: mutualCounts.get(row.id) ?? 0,
    time_ago: row.last_active ? formatTimeAgo(new Date(row.last_active)) : null,
  }));

  let sorted = enriched;
  if (sortBy === "name") {
    sorted = enriched.sort((a, b) => (sortDir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)));
  } else if (sortBy === "connection_date") {
    sorted = enriched.sort((a, b) => {
      const av = a.connection_date?.getTime?.() ?? 0;
      const bv = b.connection_date?.getTime?.() ?? 0;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  } else if (sortBy === "last_active") {
    sorted = enriched.sort((a, b) => {
      const av = a.last_active ? new Date(a.last_active).getTime() : 0;
      const bv = b.last_active ? new Date(b.last_active).getTime() : 0;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  } else if (sortBy === "mutual_connections") {
    sorted = enriched.sort((a, b) => (sortDir === "asc" ? a.mutual_connections - b.mutual_connections : b.mutual_connections - a.mutual_connections));
  }

  const total = sorted.length;
  const skip = (page - 1) * limit;
  const pageRows = sorted.slice(skip, skip + limit);
  const nextCursor = pageRows.length > 0 ? pageRows[pageRows.length - 1].connectionId : null;

  const payload = {
    connections: pageRows,
    pagination: {
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
      has_next: skip + pageRows.length < total,
      has_previous: page > 1,
      next_cursor: nextCursor,
    },
    sorting: { field: sortBy, direction: sortDir },
  };

  setCached(cacheKey, payload, CONNECTION_CACHE_TTL.LIST_MS);
  return NextResponse.json(serialize({ success: true, ...payload }), { status: 200 });
}
