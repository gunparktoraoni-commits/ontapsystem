import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { getIncidentDetail, listGroupedIncidents } from "@/lib/services/dev/dev-portal.service";

export const GET = withDashboardSuperAdmin(async (request: NextRequest) => {
  const incidentId = request.nextUrl.searchParams.get("incidentId");
  try {
    if (incidentId) {
      const detail = await getIncidentDetail(incidentId);
      const companies = new Map<string, { companyId: string; affectedUsers: number }>();
      for (const user of detail?.relatedUsers ?? []) {
        if (!user.companyId) continue;
        const current = companies.get(user.companyId) ?? { companyId: user.companyId, affectedUsers: 0 };
        current.affectedUsers += 1;
        companies.set(user.companyId, current);
      }
      return NextResponse.json({ success: true, data: Array.from(companies.values()) });
    }

    const incidents = await listGroupedIncidents({});
    return NextResponse.json({
      success: true,
      data: incidents.items
        .filter((item) => item.affectedCompanies > 0)
        .map((item) => ({
          incidentId: item.id,
          title: item.title,
          affectedCompanies: item.affectedCompanies,
        }))
        .slice(0, 20),
    });
  } catch (error) {
    console.error("[dev/impact/companies] failed", error);
    return NextResponse.json({ success: false, error: "Failed to load impacted companies." }, { status: 500 });
  }
});
