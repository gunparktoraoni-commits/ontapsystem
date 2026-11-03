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

type RouteContext = { params: Promise<{ peerUserId: string }> };

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

function parsePeerId(raw: string, requestId: string): bigint {
  if (!/^\d{1,20}$/.test(raw)) {
    throw createConnectionMessagingError(
      ConnectionMessagingErrorCode.INVALID_PAYLOAD,
      "Invalid peer user id.",
      400,
      requestId,
    );
  }
  return BigInt(raw);
}

export async function GET(request: NextRequest, context: RouteContext) {
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

    const { peerUserId } = await context.params;
    const actor = await requireActor(request, requestId);
    const peerId = parsePeerId(peerUserId, requestId);
    const service = new ConnectionMessagingService();
    const conversation = await service.getConversationWithPeer(actor.userId, peerId);

    return NextResponse.json({
      success: true,
      data: { conversation },
      requestId,
    });
  } catch (error) {
    return connectionMessagingErrorResponse(error, requestId);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  return GET(request, context);
}
