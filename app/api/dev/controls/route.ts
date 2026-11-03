import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { getPortalPageControls } from "@/lib/services/dev/page-controls.service";
import { PORTAL_PAGE_SCOPE_LABELS } from "@/lib/portal/page-controls";

export const GET = withDashboardSuperAdmin(async (_request: NextRequest) => {
  try {
    const pages = await getPortalPageControls();
    const grouped = (["user", "admin", "staff"] as const).map((portal) => ({
      portal,
      label: PORTAL_PAGE_SCOPE_LABELS[portal],
      pages: pages.filter((page) => page.portal === portal),
    }));

    return NextResponse.json({
      success: true,
      data: {
        pages,
        grouped,
        summary: {
          total: pages.length,
          accessible: pages.filter((page) => page.enabled).length,
          maintenance: pages.filter((page) => !page.enabled).length,
          persisted: pages.filter((page) => page.persisted).length,
        },
      },
    });
  } catch (error) {
    console.error("[dev/controls] failed", error);
    return NextResponse.json(
      { success: false, error: "Failed to load controls." },
      { status: 500 },
    );
  }
});
