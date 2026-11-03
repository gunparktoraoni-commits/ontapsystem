import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { SupportMessagingService } from "@/lib/services/support-messaging.service";
import { getSupportRequestId, supportErrorResponse } from "@/lib/api/support-route-utils";

/**
 * GET /api/superadmin/support/escalations/unread/count
 * Returns unread escalated support messages for the authenticated superadmin/dev.
 */
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
    const count = await service.getUnreadCountForActor({
      userId: context.user.userId,
      role: actorRole,
    });

    return NextResponse.json({
      success: true,
      data: { count },
      requestId,
    });
  } catch (error) {
    // Badge polling must not break the portal chrome — degrade to zero on unexpected errors.
    console.error("[support/escalations/unread/count]", error);
    try {
      return supportErrorResponse(error, requestId);
    } catch {
      return NextResponse.json({ success: true, data: { count: 0 }, requestId });
    }
  }
});
