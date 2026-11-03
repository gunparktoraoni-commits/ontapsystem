import { NextRequest, NextResponse } from "next/server";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  getPortfolioLeadStats,
  isPortfolioLeadStatus,
  listPortfolioLeads,
  type PortfolioLeadStatus,
} from "@/lib/services/portfolio-lead.service";

async function requireSession(request: NextRequest) {
  const rawToken = request.cookies.get("session_token")?.value;
  if (!rawToken) return null;
  return validateToken(rawToken);
}

/**
 * GET /api/leads — list + summary stats for the authenticated portfolio owner.
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("leads-list", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } },
    );
  }

  const session = await requireSession(request);
  if (!session) {
    return NextResponse.json(
      { error: "Authentication required.", requiresAuth: true },
      { status: 401 },
    );
  }

  const { searchParams } = request.nextUrl;
  const statusRaw = (searchParams.get("status") ?? "all").trim().toLowerCase();
  const search = (searchParams.get("search") ?? "").trim();
  const page = Number(searchParams.get("page") ?? "1");
  const limit = Number(searchParams.get("limit") ?? "20");
  const statsOnly = searchParams.get("stats_only") === "1";

  if (statusRaw !== "all" && !isPortfolioLeadStatus(statusRaw)) {
    return NextResponse.json(
      { error: "Invalid status filter." },
      { status: 422 },
    );
  }

  const userId = BigInt(session.userId);
  const stats = await getPortfolioLeadStats(userId);
  if (statsOnly) {
    return NextResponse.json({ success: true, data: { stats } });
  }

  const listed = await listPortfolioLeads({
    userId,
    status: statusRaw as PortfolioLeadStatus | "all",
    search,
    page: Number.isFinite(page) ? page : 1,
    limit: Number.isFinite(limit) ? limit : 20,
  });

  return NextResponse.json({
    success: true,
    data: {
      stats,
      ...listed,
    },
  });
}
