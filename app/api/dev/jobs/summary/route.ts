import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { getJobsSummary } from "@/lib/services/dev/dev-portal.service";

export const GET = withDashboardSuperAdmin(async (_request: NextRequest) => {
  try {
    const data = await getJobsSummary();
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[dev/jobs/summary] failed", error);
    return NextResponse.json({ success: false, error: "Failed to load jobs summary." }, { status: 500 });
  }
});
