// ──────────────────────────────────────────────────────────────
// GET /api/affiliate/links/performance
// ──────────────────────────────────────────────────────────────
// Returns performance metrics for all affiliate links:
//   • Per-link: clicks, unique clicks, conversions, revenue, rate
//   • Daily performance trend for each link
//   • Top 5 links by revenue
//   • Traffic source breakdown across all links
//
// Auth:  Session cookie required.
// Rate:  30/min per IP ("affiliate-links").
// Cache: 5-minute per (userId × timeframe).
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  getAffiliateSettings,
  resolveAffiliateDateRange,
  safePercent,
} from "@/server/lib/affiliate";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

type CacheEntry = { expiresAt: number; value: unknown };
const linksCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    // ── Rate limit ─────────────────────────────────────────────
    const rl = checkRateLimit("affiliate-links", ip);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many requests." } },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      );
    }

    // ── Auth ───────────────────────────────────────────────────
    const rawToken = request.cookies.get("session_token")?.value;
    if (!rawToken) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED_ACCESS", message: "Authentication required." } },
        { status: 401 }
      );
    }
    const session = await validateToken(rawToken);
    if (!session) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED_ACCESS", message: "Session expired." } },
        { status: 401 }
      );
    }

    // ── Affiliate gate ─────────────────────────────────────────
    const settings = await getAffiliateSettings(session.userId);
    if (!settings) {
      return NextResponse.json(
        { success: false, error: { code: "AFFILIATE_NOT_ACTIVE", message: "Affiliate account not found." } },
        { status: 403 }
      );
    }

    // ── Query params ───────────────────────────────────────────
    const { searchParams } = request.nextUrl;
    const filterRaw = (searchParams.get("timeframe") ?? "month").toLowerCase();
    const validFilters = new Set(["month", "quarter", "year", "all"]);
    const timeframe = validFilters.has(filterRaw) ? filterRaw : "month";

    const cacheKey = `${session.userId}:${timeframe}`;
    const cached = linksCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return NextResponse.json({ success: true, data: cached.value, cached: true });
    }

    const range = resolveAffiliateDateRange(timeframe);
    const uid = BigInt(session.userId);

    // ── Fetch all links for this affiliate ─────────────────────
    const links = await prisma.affiliateLink.findMany({
      where: { affiliate_user_id: uid },
      orderBy: { created_at: "asc" },
    });

    if (links.length === 0) {
      const emptyResult = {
        links: [],
        top_performing: [],
        source_breakdown: {},
      };
      return NextResponse.json({ success: true, data: emptyResult });
    }

    const linkIds = links.map((l) => l.id);

    // ── Per-link click aggregates ──────────────────────────────
    const clickStats = await prisma.affiliateClick.groupBy({
      by: ["link_id"],
      where: {
        link_id: { in: linkIds },
        clicked_at: { gte: range.start, lte: range.end },
      },
      _count: { id: true },
    });

    const uniqueClickStats = await prisma.affiliateClick.groupBy({
      by: ["link_id", "visitor_id"],
      where: {
        link_id: { in: linkIds },
        clicked_at: { gte: range.start, lte: range.end },
        visitor_id: { not: null },
      },
      _count: { id: true },
    });

    // Count unique visitor_ids per link
    const uniqueByLink = new Map<bigint, number>();
    for (const row of uniqueClickStats) {
      if (!row.link_id) continue;
      uniqueByLink.set(row.link_id, (uniqueByLink.get(row.link_id) ?? 0) + 1);
    }

    const clicksByLink = new Map(clickStats.map((r) => [r.link_id, r._count.id]));

    // ── Per-link conversion counts ─────────────────────────────
    const conversionStats = await prisma.referral.groupBy({
      by: ["source_link_id"],
      where: {
        source_link_id: { in: linkIds },
        referral_date: { gte: range.start, lte: range.end },
      },
      _count: { id: true },
    });
    const conversionsByLink = new Map(conversionStats.map((r) => [r.source_link_id, r._count.id]));

    // ── Per-link revenue (commissions) ────────────────────────
    const revenueStats = await prisma.$queryRaw<
      { link_id: string; total: string }[]
    >(
      Prisma.sql`SELECT ac.link_id, SUM(c.amount) AS total
       FROM Commission c
       INNER JOIN AffiliateClick ac ON ac.conversion_user_id = c.referred_user_id
       WHERE c.affiliate_user_id = ${session.userId}
         AND c.status IN ('approved', 'paid')
         AND c.created_at >= ${range.start} AND c.created_at <= ${range.end}
         AND ac.link_id IS NOT NULL
       GROUP BY ac.link_id`
    );
    const revenueByLink = new Map(revenueStats.map((r) => [BigInt(r.link_id), Number(r.total)]));

    // ── Daily trend per link (last 14 days of the range) ──────
    const trendStart =
      range.end.getTime() - range.start.getTime() > 14 * 86_400_000 * 1000
        ? new Date(range.end.getTime() - 14 * 86_400_000)
        : range.start;

    const trendRows = await prisma.affiliateClick.groupBy({
      by: ["link_id", "clicked_at"],
      where: {
        link_id: { in: linkIds },
        clicked_at: { gte: trendStart, lte: range.end },
      },
      _count: { id: true },
    });

    // Group trend rows by link_id → date → count
    const trendByLink = new Map<bigint, Map<string, number>>();
    for (const row of trendRows) {
      if (!row.link_id) continue;
      const dateKey = (row.clicked_at as Date).toISOString().slice(0, 10);
      if (!trendByLink.has(row.link_id)) trendByLink.set(row.link_id, new Map());
      const dayMap = trendByLink.get(row.link_id)!;
      dayMap.set(dateKey, (dayMap.get(dateKey) ?? 0) + row._count.id);
    }

    // ── Build link list ────────────────────────────────────────
    const linkList = links.map((l) => {
      const clicks = clicksByLink.get(l.id) ?? 0;
      const uniqueClicks = uniqueByLink.get(l.id) ?? 0;
      const conversions = conversionsByLink.get(l.id) ?? 0;
      const revenue = revenueByLink.get(l.id) ?? 0;
      const dayMap = trendByLink.get(l.id) ?? new Map<string, number>();
      const trend = Array.from(dayMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, clicks: count }));

      return {
        id: l.id.toString(),
        name: l.name,
        url: `${process.env.FRONTEND_URL ?? ""}/?ref=${l.slug}`,
        slug: l.slug,
        created_date: l.created_at.toISOString(),
        is_active: l.is_active,
        clicks,
        unique_clicks: uniqueClicks,
        conversions,
        revenue: Math.round(revenue * 100) / 100,
        conversion_rate: safePercent(conversions, clicks),
        performance_trend: trend,
      };
    });

    // ── Top 5 by revenue ──────────────────────────────────────
    const topPerforming = [...linkList]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // ── Source breakdown (source field on clicks) ──────────────
    const sourceRows = await prisma.affiliateClick.groupBy({
      by: ["source"],
      where: {
        affiliate_user_id: uid,
        clicked_at: { gte: range.start, lte: range.end },
      },
      _count: { id: true },
    });
    const totalClicks = sourceRows.reduce((s, r) => s + r._count.id, 0);
    const sourceBreakdown: Record<string, { clicks: number; percentage: number }> = {};
    for (const row of sourceRows) {
      const key = row.source ?? "direct";
      sourceBreakdown[key] = {
        clicks: row._count.id,
        percentage: safePercent(row._count.id, totalClicks),
      };
    }

    const result = {
      links: linkList,
      top_performing: topPerforming,
      source_breakdown: sourceBreakdown,
    };

    const serialized = serialize(result);
    linksCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: serialized });

    return NextResponse.json({ success: true, data: serialized });
  } catch (err) {
    console.error("[affiliate/links/performance] error:", err);
    return NextResponse.json(
      { success: false, error: { code: "DATABASE_CONNECTION_ERROR", message: "Internal server error." } },
      { status: 500 }
    );
  }
}
