import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { getIncidentDetail, listGroupedIncidents } from "@/lib/services/dev/dev-portal.service";

export const GET = withDashboardSuperAdmin(async (request: NextRequest) => {
  const incidentId = request.nextUrl.searchParams.get("incidentId");
  try {
    if (incidentId) {
      const data = await getIncidentDetail(incidentId);
      return NextResponse.json({ success: true, data: data?.relatedUsers ?? [] });
    }

    const incidents = await listGroupedIncidents({});
    return NextResponse.json({
      success: true,
      data: incidents.items
        .filter((item) => item.affectedUsers > 0)
        .map((item) => ({
          incidentId: item.id,
          title: item.title,
          affectedUsers: item.affectedUsers,
        }))
        .slice(0, 20),
    });
  } catch (error) {
    console.error("[dev/impact/users] failed", error);
    return NextResponse.json({ success: false, error: "Failed to load impacted users." }, { status: 500 });
  }
});
