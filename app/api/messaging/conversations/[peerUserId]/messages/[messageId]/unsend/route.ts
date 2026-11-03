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

type RouteContext = { params: Promise<{ peerUserId: string; messageId: string }> };

async function requireActor(request: NextRequest, requestId: string) {
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
  return { userId };
}

function parseId(raw: string, label: string, requestId: string): bigint {
  if (!/^\d{1,20}$/.test(raw)) {
    throw createConnectionMessagingError(
      ConnectionMessagingErrorCode.INVALID_PAYLOAD,
      `Invalid ${label}.`,
      400,
      requestId,
    );
  }
  return BigInt(raw);
}

/** POST — unsend message for everyone (sender only). */
export async function POST(request: NextRequest, context: RouteContext) {
  const requestId = getConnectionMessagingRequestId(request.headers);
  try {
    const ip = getClientIp(request);
    const rate = checkRateLimit("messaging-send", ip);
    if (!rate.allowed) {
      throw createConnectionMessagingError(
        ConnectionMessagingErrorCode.RATE_LIMIT_EXCEEDED,
        "Too many requests.",
        429,
        requestId,
      );
    }

    const { peerUserId, messageId } = await context.params;
    const actor = await requireActor(request, requestId);
    const peerId = parseId(peerUserId, "peer user id", requestId);
    const msgId = parseId(messageId, "message id", requestId);

    const service = new ConnectionMessagingService();
    const data = await service.unsendMessage(actor.userId, peerId, msgId);
    return NextResponse.json({ success: true, data, requestId });
  } catch (error) {
    return connectionMessagingErrorResponse(error, requestId);
  }
}
