import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { getAuthHealthSummary } from "@/lib/services/dev/dev-portal.service";

export const GET = withDashboardSuperAdmin(async (_request: NextRequest) => {
  try {
    const data = await getAuthHealthSummary();
    return NextResponse.json({ success: true, data: data.failures });
  } catch (error) {
    console.error("[dev/auth/failures] failed", error);
    return NextResponse.json({ success: false, error: "Failed to load auth failures." }, { status: 500 });
  }
});
