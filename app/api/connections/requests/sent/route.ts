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
  const rateCheck = checkRateLimit("connections-requests-sent", ip);
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
  const sortDir = (q.get("sort_dir") ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const status = (q.get("status") ?? "pending").toLowerCase();

  const where = {
    requester_user_id: userId,
    ...(status ? { status } : {}),
  } as const;

  const total = await prisma.connection.count({ where });

  const rows = await prisma.connection.findMany({
    where,
    include: {
      recipient: {
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
          email: true,
          profile_url: true,
          company: { select: { name: true } },
        },
      },
    },
    orderBy: sortBy === "name"
      ? { recipient: { first_name: sortDir } }
      : { created_at: sortDir },
    skip: (page - 1) * limit,
    take: limit,
  });

  const filtered = rows.filter((row) => {
    if (!search) return true;
    const haystack = `${row.recipient.first_name} ${row.recipient.last_name} ${row.recipient.company?.name ?? ""}`.toLowerCase();
    return haystack.includes(search);
  });

  const recipientIds = [...new Set(filtered.map((row) => row.recipient_user_id))];
  const recipientIdSet = new Set(recipientIds.map((id) => id.toString()));
  const acceptedConnectionIds = await getAcceptedConnectionUserIds(userId);
  const mutualRows = recipientIds.length > 0 && acceptedConnectionIds.length > 0
    ? await prisma.connection.findMany({
        where: {
          status: "accepted",
          OR: [
            {
              requester_user_id: { in: recipientIds },
              recipient_user_id: { in: acceptedConnectionIds },
            },
            {
              recipient_user_id: { in: recipientIds },
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
    if (recipientIdSet.has(requesterKey)) {
      mutualCounts.set(requesterKey, (mutualCounts.get(requesterKey) ?? 0) + 1);
    }
    if (recipientIdSet.has(recipientKey)) {
      mutualCounts.set(recipientKey, (mutualCounts.get(recipientKey) ?? 0) + 1);
    }
  }

  const requests = filtered.map((row) => ({
    id: row.connect_id.toString(),
    receiver: {
      id: row.recipient.user_id.toString(),
      name: `${row.recipient.first_name} ${row.recipient.last_name}`.trim(),
      email: anonymizeEmail(row.recipient.email),
      profile_image: row.recipient.profile_url,
      business_name: row.recipient.company?.name ?? null,
      mutual_connections: mutualCounts.get(row.recipient_user_id.toString()) ?? 0,
    },
    message: null,
    sent_at: row.created_at,
    time_ago: formatTimeAgo(row.created_at),
    expires_at: null,
    status: row.status,
    reminder_sent: false,
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
        total_sent: total,
        oldest_sent: requests.length ? requests[requests.length - 1].sent_at : null,
        average_response_time: null,
      },
    }),
    { status: 200 }
  );
}
