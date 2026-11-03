import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { listSystemErrorLogs } from "@/server/lib/error-logger";

/**
 * GET /api/dev/error-logs
 * List SystemErrorLog rows for the developer portal (dev / super_admin).
 */
export const GET = withDashboardSuperAdmin(async (request: NextRequest) => {
  const ip = getClientIp(request);
  const rate = checkRateLimit("error-log", ip);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many requests." },
      { status: 429 },
    );
  }

  const params = request.nextUrl.searchParams;
  const severity = params.get("severity") ?? "all";
  const search = params.get("search") ?? undefined;
  const page = Number.parseInt(params.get("page") ?? "1", 10);
  const limit = Number.parseInt(params.get("limit") ?? "50", 10);

  try {
    const data = await listSystemErrorLogs({
      severity,
      search,
      page: Number.isFinite(page) ? page : 1,
      limit: Number.isFinite(limit) ? limit : 50,
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[dev/error-logs] list failed", error);
    return NextResponse.json(
      { success: false, error: "Failed to load error logs." },
      { status: 500 },
    );
  }
});
