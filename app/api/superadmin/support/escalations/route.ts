import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { SupportMessagingService } from "@/lib/services/support-messaging.service";
import { getSupportRequestId, supportErrorResponse } from "@/lib/api/support-route-utils";

export const GET = withDashboardSuperAdmin(async (request: NextRequest, context) => {
  const requestId = context.requestId || getSupportRequestId(request.headers);
  try {
    const ip = getClientIp(request);
    const rate = checkRateLimit("support-read", ip);
    if (!rate.allowed) {
      return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429 });
    }

    const role = String(context.user.role ?? "")
      .trim()
      .toLowerCase();
    const actorRole = role === "super_admin" ? ("super_admin" as const) : ("dev" as const);

    const service = new SupportMessagingService();
    const conversations = await service.listEscalatedConversations({
      userId: context.user.userId,
      role: actorRole,
    });

    return NextResponse.json({ success: true, data: conversations, requestId });
  } catch (error) {
    return supportErrorResponse(error, requestId);
  }
});
