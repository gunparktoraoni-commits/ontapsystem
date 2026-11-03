import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { ConnectionMessagingService } from "@/lib/services/connection-messaging.service";
import {
  getConnectionMessagingRequestId,
  connectionMessagingErrorResponse,
} from "@/lib/api/connection-messaging-route-utils";

export async function GET(request: NextRequest) {
  const requestId = getConnectionMessagingRequestId(request.headers);
  try {
    const ip = getClientIp(request);
    const rate = checkRateLimit("messaging-read", ip);
    if (!rate.allowed) {
      return NextResponse.json(
        { success: true, data: { count: 0 }, requestId },
        { status: 200 },
      );
    }

    const resolved = await resolveRequestSession(request, { tryRefresh: true });
    if (!resolved.session) {
      return NextResponse.json({ success: true, data: { count: 0 }, requestId });
    }

    const service = new ConnectionMessagingService();
    const count = await service.getUnreadCountForUser(BigInt(resolved.session.userId));
    return NextResponse.json({ success: true, data: { count }, requestId });
  } catch (error) {
    return connectionMessagingErrorResponse(error, requestId);
  }
}
