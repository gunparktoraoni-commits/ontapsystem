import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { getAuditTimeline } from "@/lib/services/dev/dev-portal.service";

export const GET = withDashboardSuperAdmin(async (request: NextRequest) => {
  const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "20", 10);
  const event = request.nextUrl.searchParams.get("event");
  try {
    const data = await getAuditTimeline({
      limit: Number.isFinite(limit) ? limit : 20,
      focusEventId: event,
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[AUDIT_TIMELINE_API][dev/audit/timeline] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to load audit timeline.",
        code: "DEV_AUDIT_TIMELINE_LOAD_FAILED",
        tag: "[AUDIT_TIMELINE_API]",
      },
      { status: 500 },
    );
  }
});
