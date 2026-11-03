import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  anonymizeEmail,
  formatTimeAgo,
  getAcceptedConnectionUserIds,
  parsePositiveInt,
  requireConnectionsSession,
  touchUserActivity,
} from "@/server/lib/connections";
import { getClientIp } from "@/server/lib/auth";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("connections-requests-received", ip);
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
  const page = parsePositiveInt(q.get("page"), 1);
  const limit = parsePositiveInt(q.get("limit"), 20, 50);
  const search = (q.get("search") ?? "").trim().toLowerCase();
  const sortBy = (q.get("sort_by") ?? "sent_at").toLowerCase();
  const sortDir = (q.get("sort_dir") ?? "asc").toLowerCase() === "desc" ? "desc" : "asc";

  const where = {
    recipient_user_id: userId,
    status: "pending",
  } as const;

  const total = await prisma.connection.count({ where });

  const rows = await prisma.connection.findMany({
    where,
    include: {
      requester: {
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
          email: true,
          profile_url: true,
          job_position: true,
          company: { select: { name: true } },
        },
      },
    },
    orderBy: sortBy === "name"
      ? { requester: { first_name: sortDir } }
      : { created_at: sortDir },
    skip: (page - 1) * limit,
    take: limit,
  });

  const filtered = rows.filter((row) => {
    if (!search) return true;
    const haystack = `${row.requester.first_name} ${row.requester.last_name} ${row.requester.company?.name ?? ""}`.toLowerCase();
    return haystack.includes(search);
  });

  const requesterIds = [...new Set(filtered.map((row) => row.requester_user_id))];
  const requesterIdSet = new Set(requesterIds.map((id) => id.toString()));
  const acceptedConnectionIds = await getAcceptedConnectionUserIds(userId);
  const mutualRows = requesterIds.length > 0 && acceptedConnectionIds.length > 0
    ? await prisma.connection.findMany({
        where: {
          status: "accepted",
          OR: [
            {
              requester_user_id: { in: requesterIds },
              recipient_user_id: { in: acceptedConnectionIds },
            },
            {
              recipient_user_id: { in: requesterIds },
              requester_user_id: { in: acceptedConnectionIds },
            },
          ],
        },
        select: {
          requester_user_id: true,
          recipient_user_id: true,
        },
      })
    : [];

  const mutualCounts = new Map<string, number>();
  for (const connection of mutualRows) {
    const requesterKey = connection.requester_user_id.toString();
    const recipientKey = connection.recipient_user_id.toString();
    if (requesterIdSet.has(requesterKey)) {
      mutualCounts.set(requesterKey, (mutualCounts.get(requesterKey) ?? 0) + 1);
    }
    if (requesterIdSet.has(recipientKey)) {
      mutualCounts.set(recipientKey, (mutualCounts.get(recipientKey) ?? 0) + 1);
    }
  }

  const requests = filtered.map((row) => ({
    id: row.connect_id.toString(),
    sender: {
      id: row.requester.user_id.toString(),
      name: `${row.requester.first_name} ${row.requester.last_name}`.trim(),
      email: anonymizeEmail(row.requester.email),
      profile_image: row.requester.profile_url,
      business_name: row.requester.company?.name ?? null,
      mutual_connections: mutualCounts.get(row.requester_user_id.toString()) ?? 0,
    },
    message: null,
    sent_at: row.created_at,
    time_ago: formatTimeAgo(row.created_at),
    expires_at: null,
    status: row.status,
  }));

  return NextResponse.json(
    serialize({
      success: true,
      requests,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
      summary: {
        total_pending: total,
        oldest_request: requests.length ? requests[requests.length - 1].sent_at : null,
      },
    }),
    { status: 200 }
  );
}
