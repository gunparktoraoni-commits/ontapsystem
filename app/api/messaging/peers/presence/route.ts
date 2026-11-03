import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { touchUserActivity } from "@/server/lib/connections";
import { ConnectionMessagingService } from "@/lib/services/connection-messaging.service";
import {
  getConnectionMessagingRequestId,
  connectionMessagingErrorResponse,
} from "@/lib/api/connection-messaging-route-utils";
import {
  ConnectionMessagingErrorCode,
  createConnectionMessagingError,
} from "@/lib/errors/connection-messaging-errors";

export async function GET(request: NextRequest) {
  const requestId = getConnectionMessagingRequestId(request.headers);
  try {
    const ip = getClientIp(request);
    const rate = checkRateLimit("messaging-read", ip);
    if (!rate.allowed) {
      throw createConnectionMessagingError(
        ConnectionMessagingErrorCode.RATE_LIMIT_EXCEEDED,
        "Too many requests.",
        429,
        requestId,
      );
    }

    const resolved = await resolveRequestSession(request, { tryRefresh: true });
    if (!resolved.session) {
      throw createConnectionMessagingError(
        ConnectionMessagingErrorCode.UNAUTHORIZED,
        "Authentication required.",
        401,
        requestId,
      );
    }

    const userId = BigInt(resolved.session.userId);
    await touchUserActivity(request, userId, BigInt(resolved.session.sessionId));

    const idsParam = request.nextUrl.searchParams.get("ids") ?? "";
    const peerIds = idsParam
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^\d{1,20}$/.test(s))
      .map((s) => BigInt(s))
      .slice(0, 100);

    const service = new ConnectionMessagingService();
    const presence = await service.getPresenceForPeers(userId, peerIds);

    return NextResponse.json({ success: true, data: { presence }, requestId });
  } catch (error) {
    return connectionMessagingErrorResponse(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getConnectionMessagingRequestId(request.headers);
  try {
    const ip = getClientIp(request);
    const rate = checkRateLimit("messaging-read", ip);
    if (!rate.allowed) {
      throw createConnectionMessagingError(
        ConnectionMessagingErrorCode.RATE_LIMIT_EXCEEDED,
        "Too many requests.",
        429,
        requestId,
      );
    }

    const resolved = await resolveRequestSession(request, { tryRefresh: true });
    if (!resolved.session) {
      throw createConnectionMessagingError(
        ConnectionMessagingErrorCode.UNAUTHORIZED,
        "Authentication required.",
        401,
        requestId,
      );
    }

    const userId = BigInt(resolved.session.userId);
    await touchUserActivity(request, userId, BigInt(resolved.session.sessionId));

    let body: { user_ids?: unknown } = {};
    try {
      body = (await request.json()) as { user_ids?: unknown };
    } catch {
      throw createConnectionMessagingError(
        ConnectionMessagingErrorCode.INVALID_PAYLOAD,
        "Invalid JSON body.",
        400,
        requestId,
      );
    }

    const rawIds = Array.isArray(body.user_ids) ? body.user_ids : [];
    const peerIds = rawIds
      .map((id) => String(id))
      .filter((s) => /^\d{1,20}$/.test(s))
      .map((s) => BigInt(s))
      .slice(0, 100);

    const service = new ConnectionMessagingService();
    const presence = await service.getPresenceForPeers(userId, peerIds);

    return NextResponse.json({ success: true, data: { presence }, requestId });
  } catch (error) {
    return connectionMessagingErrorResponse(error, requestId);
  }
}
