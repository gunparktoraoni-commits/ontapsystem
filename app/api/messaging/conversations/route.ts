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
  return { userId, session: resolved.session };
}

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

    const actor = await requireActor(request, requestId);
    const service = new ConnectionMessagingService();
    const conversations = await service.listConversationsForUser(actor.userId);

    return NextResponse.json({
      success: true,
      data: { conversations },
      requestId,
    });
  } catch (error) {
    return connectionMessagingErrorResponse(error, requestId);
  }
}
