import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { listGroupedIncidents } from "@/lib/services/dev/dev-portal.service";

export const GET = withDashboardSuperAdmin(async (request: NextRequest) => {
  const params = request.nextUrl.searchParams;
  try {
    const data = await listGroupedIncidents({
      severity: params.get("severity") ?? undefined,
      search: params.get("search") ?? undefined,
      status: params.get("status") ?? undefined,
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[dev/incidents] failed", error);
    return NextResponse.json({ success: false, error: "Failed to load incidents." }, { status: 500 });
  }
});
