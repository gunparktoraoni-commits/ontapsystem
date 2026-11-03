import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { SupportMessagingService } from "@/lib/services/support-messaging.service";
import { getSupportRequestId, supportErrorResponse } from "@/lib/api/support-route-utils";
import {
  SupportMessagingErrorCode,
  createSupportMessagingError,
} from "@/lib/errors/support-messaging-errors";

async function getUserActor(request: NextRequest, requestId: string) {
  const resolved = await resolveRequestSession(request, { tryRefresh: true });
  if (!resolved.session) {
    throw createSupportMessagingError(
      SupportMessagingErrorCode.UNAUTHORIZED,
      "Authentication required.",
      401,
      requestId,
    );
  }
  return {
    userId: BigInt(resolved.session.userId),
    role: "user" as const,
  };
}

export async function GET(request: NextRequest) {
  const requestId = getSupportRequestId(request.headers);
  try {
    const ip = getClientIp(request);
    const rate = checkRateLimit("support-read", ip);
    if (!rate.allowed) {
      return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429 });
    }

    const actor = await getUserActor(request, requestId);
    const service = new SupportMessagingService();
    const conversation = await service.getOrCreateConversationForClient(actor.userId);
    const before = request.nextUrl.searchParams.get("before");
    const q = request.nextUrl.searchParams.get("q") ?? undefined;
    let beforeId: bigint | undefined;
    if (before) {
      try {
        beforeId = BigInt(before);
      } catch {
        throw createSupportMessagingError(
          SupportMessagingErrorCode.INVALID_PAYLOAD,
          "Invalid before cursor.",
          400,
          requestId,
        );
      }
    }
    const messages = await service.listMessages(BigInt(conversation.id), actor, {
      before: beforeId,
      q,
    });

    return NextResponse.json({
      success: true,
      data: { conversation, messages },
      requestId,
    });
  } catch (error) {
    return supportErrorResponse(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getSupportRequestId(request.headers);
  try {
    const ip = getClientIp(request);
    const rate = checkRateLimit("support-message-send", ip);
    if (!rate.allowed) {
      return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429 });
    }

    const actor = await getUserActor(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    const text = typeof body.body === "string" ? body.body : "";
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];

    const service = new SupportMessagingService();
    const conversation = await service.getOrCreateConversationForClient(actor.userId);
    const message = await service.sendMessage(BigInt(conversation.id), actor, {
      body: text,
      attachments: attachments
        .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object")
        .map((a) => ({
          mediaUrl: String(a.mediaUrl ?? ""),
          mimeType: String(a.mimeType ?? ""),
          mediaKind: a.mediaKind === "video" ? "video" : "image",
          fileName: typeof a.fileName === "string" ? a.fileName : undefined,
          fileSize: typeof a.fileSize === "number" ? a.fileSize : undefined,
        })),
    });

    return NextResponse.json({ success: true, data: message, requestId }, { status: 201 });
  } catch (error) {
    return supportErrorResponse(error, requestId);
  }
}
