import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { SupportMessagingService } from "@/lib/services/support-messaging.service";
import { getSupportRequestId, supportErrorResponse } from "@/lib/api/support-route-utils";



export async function GET(request: NextRequest) {
  const requestId = getSupportRequestId(request.headers);
  try {
    const ip = getClientIp(request);
    const rate = checkRateLimit("support-read", ip);
    if (!rate.allowed) {
      return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429 });
    }

    const resolved = await resolveRequestSession(request, { tryRefresh: true });

    // If not authenticated (e.g., during signup flow), return zero count
    // instead of 401. This allows the layout to safely poll during signup.
    if (!resolved.session) {
      return NextResponse.json({ success: true, data: { count: 0 }, requestId });
    }

    const service = new SupportMessagingService();
    const count = await service.getUnreadCountForActor({
      userId: BigInt(resolved.session.userId),
      role: "user",
    });

    return NextResponse.json({ success: true, data: { count }, requestId });
  } catch (error) {
    // Badge polling must not break the portal chrome — degrade to zero on unexpected errors.
    console.error("[support/unread/count]", error);
    try {
      return supportErrorResponse(error, requestId);
    } catch {
      return NextResponse.json({ success: true, data: { count: 0 }, requestId });
    }
  }
}
