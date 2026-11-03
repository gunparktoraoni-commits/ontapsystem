import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { getJobFailures } from "@/lib/services/dev/dev-portal.service";

export const GET = withDashboardSuperAdmin(async (request: NextRequest) => {
  const type = request.nextUrl.searchParams.get("type") ?? "email";
  try {
    const data = await getJobFailures(type);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[dev/jobs/failures] failed", error);
    return NextResponse.json({ success: false, error: "Failed to load job failures." }, { status: 500 });
  }
});
