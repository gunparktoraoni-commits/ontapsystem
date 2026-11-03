import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  clearConnectionCachePrefix,
  parsePositiveInt,
  requireConnectionsSession,
  touchUserActivity,
} from "@/server/lib/connections";

const TAG_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,49}$/;

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("connections-tags", ip);
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

  const page = parsePositiveInt(request.nextUrl.searchParams.get("page"), 1);
  const limit = parsePositiveInt(request.nextUrl.searchParams.get("limit"), 50, 100);

  const [rows, total] = await Promise.all([
    prisma.connectionTag.findMany({
      where: { user_id: userId },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ tag: "asc" }, { created_at: "desc" }],
    }),
    prisma.connectionTag.count({ where: { user_id: userId } }),
  ]);

  return NextResponse.json(
    {
      success: true,
      tags: rows.map((r) => ({
        id: r.id.toString(),
        connection_id: r.connection_id.toString(),
        tag: r.tag,
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    },
    { status: 200 }
  );
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("connections-tags", ip);
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

  let body: { connection_id?: string; tag?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.connection_id || !/^\d{1,20}$/.test(body.connection_id)) {
    return NextResponse.json({ error: "connection_id is required." }, { status: 400 });
  }

  const tag = (body.tag ?? "").trim();
  if (!TAG_REGEX.test(tag)) {
    return NextResponse.json({ error: "Invalid tag format." }, { status: 400 });
  }

  const connectionId = BigInt(body.connection_id);

  const hasConnection = await prisma.connection.findFirst({
    where: {
      status: "accepted",
      OR: [
        { requester_user_id: userId, recipient_user_id: connectionId },
        { requester_user_id: connectionId, recipient_user_id: userId },
      ],
    },
    select: { connect_id: true },
  });

  if (!hasConnection) {
    return NextResponse.json({ error: "Tag target must be an accepted connection." }, { status: 403 });
  }

  const created = await prisma.connectionTag.upsert({
    where: {
      user_id_connection_id_tag: {
        user_id: userId,
        connection_id: connectionId,
        tag,
      },
    },
    create: {
      user_id: userId,
      connection_id: connectionId,
      tag,
    },
    update: {},
  });

  clearConnectionCachePrefix(`list:${userId.toString()}:`);
  clearConnectionCachePrefix(`filters:${userId.toString()}`);

  return NextResponse.json(
    {
      success: true,
      tag: {
        id: created.id.toString(),
        connection_id: created.connection_id.toString(),
        tag: created.tag,
      },
      message: "Tag added successfully",
    },
    { status: 201 }
  );
}

export async function DELETE(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("connections-tags", ip);
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

  const idParam = request.nextUrl.searchParams.get("id");
  if (!idParam || !/^\d{1,20}$/.test(idParam)) {
    return NextResponse.json({ error: "id query parameter is required." }, { status: 400 });
  }

  const id = BigInt(idParam);

  const row = await prisma.connectionTag.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Tag not found." }, { status: 404 });
  if (row.user_id !== userId) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  await prisma.connectionTag.delete({ where: { id } });

  clearConnectionCachePrefix(`list:${userId.toString()}:`);
  clearConnectionCachePrefix(`filters:${userId.toString()}`);

  return NextResponse.json({ success: true, message: "Tag removed successfully" }, { status: 200 });
}
