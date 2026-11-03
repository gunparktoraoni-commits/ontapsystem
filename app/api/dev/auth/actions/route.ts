import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  forceLogoutUsers,
  restrictLoginUsers,
} from "@/lib/services/dev/auth-health.service";
import { getClientIp, getUserAgent } from "@/server/lib/auth";

export const POST = withDashboardSuperAdmin(async (request: NextRequest, context) => {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      userIds?: string[];
      reason?: string;
      durationDays?: number | null;
    };

    const userIds = Array.isArray(body.userIds)
      ? body.userIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : [];
    if (!userIds.length) {
      return NextResponse.json(
        { success: false, error: "Select at least one user." },
        { status: 422 },
      );
    }

    const actorUserId = String(context.user.userId);
    const ipAddress = getClientIp(request);
    const userAgent = getUserAgent(request);

    if (body.action === "logout") {
      const result = await forceLogoutUsers({
        userIds,
        actorUserId,
        ipAddress,
        userAgent,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (body.action === "restrict") {
      const result = await restrictLoginUsers({
        userIds,
        actorUserId,
        reason: typeof body.reason === "string" ? body.reason : "",
        durationDays: body.durationDays ?? null,
        ipAddress,
        userAgent,
      });
      return NextResponse.json({ success: true, data: result });
    }

    return NextResponse.json(
      { success: false, error: "action must be logout or restrict." },
      { status: 422 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update auth health.";
    console.error("[dev/auth/actions]", error);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
});
