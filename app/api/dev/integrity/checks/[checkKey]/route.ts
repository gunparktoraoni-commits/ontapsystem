import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { getIntegrityCheckDetail } from "@/lib/services/dev/dev-portal.service";

export const GET = withDashboardSuperAdmin(
  async (_request: NextRequest, { params }: { params: Promise<{ checkKey: string }> }) => {
    try {
      const { checkKey } = await params;
      const data = await getIntegrityCheckDetail(checkKey);
      return NextResponse.json({ success: true, data });
    } catch (error) {
      console.error("[dev/integrity/checks/:checkKey] failed", error);
      return NextResponse.json({ success: false, error: "Failed to load check detail." }, { status: 500 });
    }
  },
);
