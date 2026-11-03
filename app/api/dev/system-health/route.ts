import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { resolveAuthDateRange } from "@/lib/services/dev/auth-health.service";
import { getSystemHealthSummary } from "@/lib/services/dev/dev-portal.service";

export const GET = withDashboardSuperAdmin(async (request: NextRequest) => {
  try {
    const range = resolveAuthDateRange({
      range: request.nextUrl.searchParams.get("range"),
      from: request.nextUrl.searchParams.get("from"),
      to: request.nextUrl.searchParams.get("to"),
    });
    const data = await getSystemHealthSummary(range);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load system health.";
    console.error("[SYSTEM_HEALTH_API][dev/system-health] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: message,
        code: "DEV_SYSTEM_HEALTH_LOAD_FAILED",
        tag: "[SYSTEM_HEALTH_API]",
      },
      { status: /Invalid|must be/i.test(message) ? 422 : 500 },
    );
  }
});
