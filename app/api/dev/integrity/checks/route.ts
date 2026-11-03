import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { getIntegrityChecks } from "@/lib/services/dev/dev-portal.service";

export const GET = withDashboardSuperAdmin(async (_request: NextRequest) => {
  try {
    const data = await getIntegrityChecks();
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[dev/integrity/checks] failed", error);
    return NextResponse.json({ success: false, error: "Failed to load integrity checks." }, { status: 500 });
  }
});
