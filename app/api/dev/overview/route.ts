import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { getOverviewData } from "@/lib/services/dev/dev-portal.service";

export const GET = withDashboardSuperAdmin(async (_request: NextRequest) => {
  try {
    const data = await getOverviewData();
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[dev/overview] failed", error);
    return NextResponse.json({ success: false, error: "Failed to load dev overview." }, { status: 500 });
  }
});
