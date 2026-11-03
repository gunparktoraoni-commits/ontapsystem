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
    const before = request.nextUrl.searchParams.get("before");
    let beforeId: bigint | undefined;
    if (before) {
      if (!/^\d{1,20}$/.test(before)) {
        throw createConnectionMessagingError(
          ConnectionMessagingErrorCode.INVALID_PAYLOAD,
          "Invalid before cursor.",
          400,
          requestId,
        );
      }
      beforeId = BigInt(before);
    }

    const service = new ConnectionMessagingService();
    const data = await service.listMessages(actor.userId, peerId, { before: beforeId });

    return NextResponse.json({ success: true, data, requestId });
  } catch (error) {
    return connectionMessagingErrorResponse(error, requestId);
  }
}

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

    const { peerUserId } = await context.params;
    const actor = await requireActor(request, requestId);
    const peerId = parsePeerId(peerUserId, requestId);

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw createConnectionMessagingError(
        ConnectionMessagingErrorCode.INVALID_PAYLOAD,
        "Invalid JSON body.",
        400,
        requestId,
      );
    }

    const text = typeof body.body === "string" ? body.body : "";
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    const sharedAssociateUserId =
      typeof body.sharedAssociateUserId === "string" &&
      /^\d{1,20}$/.test(body.sharedAssociateUserId)
        ? BigInt(body.sharedAssociateUserId)
        : undefined;

    const service = new ConnectionMessagingService();
    const message = await service.sendMessage(actor.userId, peerId, {
      body: text,
      sharedAssociateUserId,
      attachments: attachments
        .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object")
        .map((a) => ({
          mediaUrl: String(a.mediaUrl ?? ""),
          mimeType: String(a.mimeType ?? ""),
          mediaKind: a.mediaKind === "video" ? ("video" as const) : ("image" as const),
          fileName: typeof a.fileName === "string" ? a.fileName : undefined,
          fileSize: typeof a.fileSize === "number" ? a.fileSize : undefined,
        })),
    });

    return NextResponse.json({ success: true, data: message, requestId }, { status: 201 });
  } catch (error) {
    return connectionMessagingErrorResponse(error, requestId);
  }
}
