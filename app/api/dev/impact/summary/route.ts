import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { listGroupedIncidents } from "@/lib/services/dev/dev-portal.service";

export const GET = withDashboardSuperAdmin(async (_request: NextRequest) => {
  try {
    const incidents = await listGroupedIncidents({});
    const totalAffectedUsers = incidents.items.reduce((sum, item) => sum + item.affectedUsers, 0);
    const totalAffectedCompanies = incidents.items.reduce((sum, item) => sum + item.affectedCompanies, 0);
    const hotspots = incidents.items
      .slice()
      .sort((a, b) => b.affectedUsers - a.affectedUsers || b.occurrences - a.occurrences)
      .slice(0, 5);

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          incidentCount: incidents.items.length,
          totalAffectedUsers,
          totalAffectedCompanies,
        },
        hotspots,
      },
    });
  } catch (error) {
    console.error("[dev/impact/summary] failed", error);
    return NextResponse.json({ success: false, error: "Failed to load impact summary." }, { status: 500 });
  }
});
