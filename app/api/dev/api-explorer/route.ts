import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { API_REGISTRY, computeRegistryStats } from "@/lib/data/api-registry";
import {
  PAGE_API_USAGE,
  enrichApisWithPages,
  PORTAL_LABELS,
} from "@/lib/data/api-page-map";

export const GET = withDashboardSuperAdmin(async (_request: NextRequest) => {
  try {
    const stats = computeRegistryStats(API_REGISTRY);

    const lifecycleOrder: Record<string, number> = {
      primary: 0,
      fallback: 1,
      legacy: 2,
      internal: 3,
      deprecated: 4,
    };

    const sorted = [...API_REGISTRY].sort((a, b) => {
      const lo = (lifecycleOrder[a.lifecycle] ?? 5) - (lifecycleOrder[b.lifecycle] ?? 5);
      if (lo !== 0) return lo;
      return a.category.localeCompare(b.category);
    });

    const apis = enrichApisWithPages(sorted);

    const mappedCount = apis.filter((a) => a.usedByPages.length > 0).length;
    const pagesByPortal: Record<string, number> = {};
    for (const p of PAGE_API_USAGE) {
      pagesByPortal[p.portal] = (pagesByPortal[p.portal] ?? 0) + 1;
    }

    return NextResponse.json({
      success: true,
      data: {
        apis,
        pages: PAGE_API_USAGE,
        portalLabels: PORTAL_LABELS,
        stats: {
          ...stats,
          mappedEndpoints: mappedCount,
          totalPages: PAGE_API_USAGE.length,
          pagesByPortal,
        },
      },
    });
  } catch (error) {
    console.error("[dev/api-explorer] failed", error);
    return NextResponse.json(
      { success: false, error: "Failed to load API explorer data." },
      { status: 500 },
    );
  }
});
