import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { SuperAdminDashboardService } from "@/lib/services/superadmin-dashboard.service";

export const GET = withDashboardSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId } = context;

  const service = new SuperAdminDashboardService(requestId);
  const health = await service.getSystemHealth();

  const cookieAnalytics = (health as any)?.cookie_preferences_analytics ?? {};
  const byCategory = cookieAnalytics.by_category ?? {};
  const byVersionCounts = cookieAnalytics.consent_by_version ?? {};

  const versionTotal = Object.values(byVersionCounts).reduce((acc: number, value: any) => acc + (Number(value) || 0), 0);
  const consentByVersionPercent: Record<string, number> = {};
  for (const [version, count] of Object.entries(byVersionCounts)) {
    const pct = versionTotal > 0 ? (Number(count) / versionTotal) * 100 : 0;
    consentByVersionPercent[version] = Math.round(pct * 100) / 100;
  }

  return NextResponse.json({
    success: true,
    data: {
      cookie_preferences_summary: {
        total_users_with_preferences: Number(cookieAnalytics.total_users_with_preferences) || 0,
        consent_rate: Number(cookieAnalytics.consent_rate) || 0,
        by_category: byCategory,
        consent_by_version: consentByVersionPercent,
        preferences_trend_last_30_days: Array.isArray(cookieAnalytics.preferences_trend_last_30_days)
          ? cookieAnalytics.preferences_trend_last_30_days
          : [],
      },
      system_health: {
        cookie_preference_storage:
          (health as any)?.databases?.main?.status === "healthy" ? "operational" : "degraded",
        session_management:
          (health as any)?.databases?.main?.status === "healthy" ? "operational" : "degraded",
        api_response_time_avg_ms: Number((health as any)?.api?.average_response_time_ms) || 0,
        error_rate_last_24h: Number((health as any)?.errors?.error_rate_percent) || 0,
      },
    },
    meta: {
      requestId,
      responseTime: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
  });
});

