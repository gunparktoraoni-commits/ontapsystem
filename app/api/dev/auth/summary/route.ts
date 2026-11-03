import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  getAuthHealthDashboard,
  resolveAuthDateRange,
} from "@/lib/services/dev/auth-health.service";

export const GET = withDashboardSuperAdmin(async (request: NextRequest) => {
  try {
    const range = resolveAuthDateRange({
      range: request.nextUrl.searchParams.get("range"),
      from: request.nextUrl.searchParams.get("from"),
      to: request.nextUrl.searchParams.get("to"),
    });
    const data = await getAuthHealthDashboard(range);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load auth health.";
    console.error("[dev/auth/summary] failed", error);
    return NextResponse.json(
      { success: false, error: message },
      { status: /Invalid|must be/i.test(message) ? 422 : 500 },
    );
  }
});
