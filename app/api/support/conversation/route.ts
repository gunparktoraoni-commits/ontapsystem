import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { SupportMessagingService } from "@/lib/services/support-messaging.service";
import { getSupportRequestId, supportErrorResponse } from "@/lib/api/support-route-utils";
import {
  SupportMessagingErrorCode,
  createSupportMessagingError,
} from "@/lib/errors/support-messaging-errors";

export async function GET(request: NextRequest) {
  const requestId = getSupportRequestId(request.headers);
  try {
    const ip = getClientIp(request);
    const rate = checkRateLimit("support-read", ip);
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many requests." },
        { status: 429 },
      );
    }

    const resolved = await resolveRequestSession(request, { tryRefresh: true });
    if (!resolved.session) {
      throw createSupportMessagingError(
        SupportMessagingErrorCode.UNAUTHORIZED,
        "Authentication required.",
        401,
        requestId,
      );
    }

    const service = new SupportMessagingService();
    const userId = BigInt(resolved.session.userId);
    const conversation =
      request.nextUrl.searchParams.get("create") === "false"
        ? await service.findConversationForClient(userId)
        : await service.getOrCreateConversationForClient(userId);

    return NextResponse.json({ success: true, data: conversation, requestId });
  } catch (error) {
    return supportErrorResponse(error, requestId);
  }
}
