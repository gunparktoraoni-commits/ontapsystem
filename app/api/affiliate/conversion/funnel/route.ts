// ──────────────────────────────────────────────────────────────
// GET /api/affiliate/conversion/funnel
// ──────────────────────────────────────────────────────────────
// Conversion funnel analysis:
//   • Funnel metrics: views → clicks → signups → first orders → repeat orders
//   • Conversion rates at each stage
//   • Historical daily/weekly trend
//   • Period-over-period comparison
//
// Auth:  Session cookie required.
// Rate:  30/min per IP ("affiliate-funnel").
// Cache: 5-minute in-memory cache per (userId × timeframe).
//
// Query params:
//   timeframe — month | quarter | year | all (default: month)
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
  formatPctChange,
} from "@/server/lib/affiliate";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

type CacheEntry = { expiresAt: number; value: unknown };
const funnelCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    // ── Rate limit ─────────────────────────────────────────────
    const rl = checkRateLimit("affiliate-funnel", ip);
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
    const cached = funnelCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return NextResponse.json({ success: true, data: cached.value, cached: true });
    }

    const range = resolveAffiliateDateRange(timeframe);
    const uid = BigInt(session.userId);

    // ── Parallel funnel counts ─────────────────────────────────
    const [
      periodClicks,
      uniquePeriodClicks,
      periodSignups,
      periodFirstOrders,
      periodRepeatOrders,
      prevClicks,
      prevUniqueClicks,
      prevSignups,
      prevFirstOrders,
    ] = await Promise.all([
      // Total link clicks
      prisma.affiliateClick.count({
        where: { affiliate_user_id: uid, clicked_at: { gte: range.start, lte: range.end } },
      }),
      // Unique clicks (distinct visitor_id)
      prisma.affiliateClick.groupBy({
        by: ["visitor_id"],
        where: { affiliate_user_id: uid, clicked_at: { gte: range.start, lte: range.end }, visitor_id: { not: null } },
        _count: true,
      }).then((rows) => rows.length),
      // Signups driven by this affiliate (referrals created in range)
      prisma.referral.count({
        where: { affiliate_user_id: uid, referral_date: { gte: range.start, lte: range.end } },
      }),
      // Referrals whose first order was within the range
      prisma.referral.count({
        where: {
          affiliate_user_id: uid,
          first_order_id: { not: null },
          conversion_date: { gte: range.start, lte: range.end },
        },
      }),
      // Commissions on repeat orders (recurring type) in range
      prisma.commission.count({
        where: {
          affiliate_user_id: uid,
          commission_type: "recurring",
          created_at: { gte: range.start, lte: range.end },
        },
      }),
      // Previous period clicks
      prisma.affiliateClick.count({
        where: { affiliate_user_id: uid, clicked_at: { gte: range.prevStart, lte: range.prevEnd } },
      }),
      // Previous period unique clicks
      prisma.affiliateClick.groupBy({
        by: ["visitor_id"],
        where: { affiliate_user_id: uid, clicked_at: { gte: range.prevStart, lte: range.prevEnd }, visitor_id: { not: null } },
        _count: true,
      }).then((rows) => rows.length),
      // Previous period signups
      prisma.referral.count({
        where: { affiliate_user_id: uid, referral_date: { gte: range.prevStart, lte: range.prevEnd } },
      }),
      // Previous period first orders
      prisma.referral.count({
        where: {
          affiliate_user_id: uid,
          first_order_id: { not: null },
          conversion_date: { gte: range.prevStart, lte: range.prevEnd },
        },
      }),
    ]);

    // ── Historical daily trend (clicks, referrals, commissions) ─
    const [clickTrendRows, referralTrendRows, orderTrendRows] = await Promise.all([
      prisma.$queryRaw<{ date: Date | string; clicks: bigint | number }[]>(
        Prisma.sql`SELECT DATE(clicked_at) AS date, COUNT(id) AS clicks
         FROM AffiliateClick
         WHERE affiliate_user_id = ${session.userId}
           AND clicked_at >= ${range.start} AND clicked_at <= ${range.end}
         GROUP BY DATE(clicked_at)
         ORDER BY date ASC`
      ),
      prisma.$queryRaw<{ date: Date | string; signups: bigint | number }[]>(
        Prisma.sql`SELECT DATE(referral_date) AS date, COUNT(id) AS signups
         FROM Referral
         WHERE affiliate_user_id = ${session.userId}
           AND referral_date >= ${range.start} AND referral_date <= ${range.end}
         GROUP BY DATE(referral_date)
         ORDER BY date ASC`
      ),
      prisma.$queryRaw<{ date: Date | string; orders: bigint | number }[]>(
        Prisma.sql`SELECT DATE(created_at) AS date, COUNT(id) AS orders
         FROM Commission
         WHERE affiliate_user_id = ${session.userId}
           AND created_at >= ${range.start} AND created_at <= ${range.end}
         GROUP BY DATE(created_at)
         ORDER BY date ASC`
      ),
    ]);

    const toDateKey = (value: Date | string): string => {
      if (value instanceof Date) return value.toISOString().slice(0, 10);
      const raw = String(value).trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
    };

    const trendMap = new Map<string, { clicks: number; signups: number; orders: number }>();
    const ensureDay = (key: string) => {
      if (!trendMap.has(key)) trendMap.set(key, { clicks: 0, signups: 0, orders: 0 });
      return trendMap.get(key)!;
    };

    for (const row of clickTrendRows) {
      const key = toDateKey(row.date);
      if (!key) continue;
      ensureDay(key).clicks = Number(row.clicks) || 0;
    }
    for (const row of referralTrendRows) {
      const key = toDateKey(row.date);
      if (!key) continue;
      ensureDay(key).signups = Number(row.signups) || 0;
    }
    for (const row of orderTrendRows) {
      const key = toDateKey(row.date);
      if (!key) continue;
      ensureDay(key).orders = Number(row.orders) || 0;
    }

    const historicalTrend = Array.from(trendMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({
        date,
        clicks: counts.clicks,
        signups: counts.signups,
        orders: counts.orders,
        rate: safePercent(counts.signups, counts.clicks),
      }));

    // ── Compute rates ──────────────────────────────────────────
    const overallRate = safePercent(periodSignups, periodClicks);
    const prevOverallRate = safePercent(prevSignups, prevClicks);

    const result = {
      funnel_metrics: {
        profile_views: 0, // Requires portfolio-view data scoped to affiliate; set to 0 unless analytics DB is joined
        link_clicks: periodClicks,
        signups: periodSignups,
        first_orders: periodFirstOrders,
        repeat_orders: periodRepeatOrders,
        unique_clicks: uniquePeriodClicks,
      },
      conversion_rates: {
        click_to_signup: safePercent(periodSignups, periodClicks),
        signup_to_order: safePercent(periodFirstOrders, periodSignups),
        overall: overallRate,
        overall_click_to_order: overallRate,
      },
      historical_trend: historicalTrend,
      comparison_to_previous: {
        rate_change:
          timeframe !== "all"
            ? formatPctChange(overallRate, prevOverallRate)
            : "n/a",
        clicks_change:
          timeframe !== "all"
            ? formatPctChange(periodClicks, prevClicks)
            : "n/a",
        signups_change:
          timeframe !== "all"
            ? formatPctChange(periodSignups, prevSignups)
            : "n/a",
        orders_change:
          timeframe !== "all"
            ? formatPctChange(periodFirstOrders, prevFirstOrders)
            : "n/a",
        previous_period: {
          clicks: prevClicks,
          unique_clicks: prevUniqueClicks,
          signups: prevSignups,
          first_orders: prevFirstOrders,
          rate: prevOverallRate,
        },
      },
      period: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        timeframe,
      },
    };

    const serialized = serialize(result);
    funnelCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: serialized });

    return NextResponse.json({ success: true, data: serialized });
  } catch (err) {
    console.error("[affiliate/conversion/funnel] error:", err);
    return NextResponse.json(
      { success: false, error: { code: "DATABASE_CONNECTION_ERROR", message: "Internal server error." } },
      { status: 500 }
    );
  }
}
