import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { getIncidentDetail, saveIncidentState } from "@/lib/services/dev/dev-portal.service";

export const GET = withDashboardSuperAdmin(
  async (_request: NextRequest, { params }: { params: Promise<{ incidentId: string }> }) => {
    try {
      const { incidentId } = await params;
      const data = await getIncidentDetail(incidentId);
      if (!data) {
        return NextResponse.json({ success: false, error: "Incident not found." }, { status: 404 });
      }
      return NextResponse.json({ success: true, data });
    } catch (error) {
      console.error("[dev/incidents/:incidentId] failed", error);
      return NextResponse.json({ success: false, error: "Failed to load incident." }, { status: 500 });
    }
  },
);

export const PATCH = withDashboardSuperAdmin(
  async (request: NextRequest, { params }: { params: Promise<{ incidentId: string }> }) => {
    try {
      const { incidentId } = await params;
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      await saveIncidentState(incidentId, {
        status: typeof body.status === "string" ? (body.status as "open" | "investigating" | "monitoring" | "resolved") : undefined,
        ownerUserId: typeof body.ownerUserId === "number" ? body.ownerUserId : null,
        resolutionNote: typeof body.resolutionNote === "string" ? body.resolutionNote : null,
      });
      return NextResponse.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update incident.";
      return NextResponse.json({ success: false, error: message }, { status: 400 });
    }
  },
);
