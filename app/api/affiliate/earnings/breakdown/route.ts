// ──────────────────────────────────────────────────────────────
// GET /api/affiliate/earnings/breakdown
// ──────────────────────────────────────────────────────────────
// Detailed earnings analysis for charts and reporting:
//   • Earnings by period (daily or monthly time-series)
//   • Earnings by source (named links or bare ref=-code)
//   • Pending earnings list with expected clearance dates
//
// Auth:  Session cookie required.
// Rate:  30/min per IP ("affiliate-earnings").
// Cache: 5-minute in-memory cache per (userId × filter × granularity).
//
// Query params:
//   filter       — month | quarter | year | all (default: month)
//   granularity  — day | month (default: day)
//   page / limit — for pending_earnings pagination
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { withPerformanceTracking } from "@/middleware/performance";
import { getAffiliateSettings, resolveAffiliateDateRange } from "@/server/lib/affiliate";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

type CacheEntry = { expiresAt: number; value: unknown };
const earningsCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

// Expected clearance window: 14 days from order date
const CLEARANCE_DAYS = 14;

function toPositiveInt(v: string | null, fallback: number): number {
  if (!v) return fallback;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export async function GET(request: NextRequest) {
  return withPerformanceTracking(request, async () => {
    const ip = getClientIp(request);

    try {
    // ── Rate limit ─────────────────────────────────────────────
    const rl = checkRateLimit("affiliate-earnings", ip);
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
    const filterRaw = (searchParams.get("filter") ?? "month").toLowerCase();
    const granularity = searchParams.get("granularity") === "month" ? "month" : "day";
    const page = toPositiveInt(searchParams.get("page"), 1);
    const limit = Math.min(toPositiveInt(searchParams.get("limit"), 20), 100);

    const validFilters = new Set(["month", "quarter", "year", "all"]);
    const filter = validFilters.has(filterRaw) ? filterRaw : "month";

    const cacheKey = `${session.userId}:${filter}:${granularity}:${page}:${limit}`;
    const cached = earningsCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return NextResponse.json({ success: true, data: cached.value, cached: true });
    }

    const range = resolveAffiliateDateRange(filter);
    const uid = BigInt(session.userId);

    // ── Fetch commissions in range (approved + paid) ───────────
    const commissions = await prisma.commission.findMany({
      where: {
        affiliate_user_id: uid,
        status: { in: ["approved", "paid"] },
        created_at: { gte: range.start, lte: range.end },
      },
      select: {
        amount: true,
        commission_type: true,
        created_at: true,
      },
      orderBy: { created_at: "asc" },
    });

    // ── Aggregate by period ────────────────────────────────────
    const periodMap = new Map<
      string,
      { amount: number; ordersCount: number; commissionType: string }
    >();

    for (const c of commissions) {
      const key =
        granularity === "month"
          ? `${c.created_at.getUTCFullYear()}-${String(c.created_at.getUTCMonth() + 1).padStart(2, "0")}`
          : c.created_at.toISOString().slice(0, 10);

      const existing = periodMap.get(key);
      if (existing) {
        existing.amount += Number(c.amount);
        existing.ordersCount++;
      } else {
        periodMap.set(key, {
          amount: Number(c.amount),
          ordersCount: 1,
          commissionType: c.commission_type,
        });
      }
    }

    const earningsByPeriod = Array.from(periodMap.entries()).map(([period, v]) => ({
      period,
      amount: Math.round(v.amount * 100) / 100,
      orders_count: v.ordersCount,
      commission_type: v.commissionType,
    }));

    // ── Earnings by source (link name or "direct") ────────────
    const commissionsByLink = await prisma.$queryRaw<
      { source: string | null; total: string; cnt: string }[]
    >(
      Prisma.sql`SELECT al.name AS source, SUM(c.amount) AS total, COUNT(*) AS cnt
       FROM Commission c
       LEFT JOIN AffiliateClick ac ON ac.conversion_user_id = c.referred_user_id
       LEFT JOIN AffiliateLink al ON al.id = ac.link_id
       WHERE c.affiliate_user_id = ${session.userId}
         AND c.status IN ('approved', 'paid')
         AND c.created_at >= ${range.start} AND c.created_at <= ${range.end}
       GROUP BY al.name`
    );

    const totalEarnings = commissionsByLink.reduce((s, r) => s + Number(r.total), 0);
    const earningsBySource = commissionsByLink.map((r) => ({
      source: r.source ?? "direct",
      amount: Math.round(Number(r.total) * 100) / 100,
      percentage:
        totalEarnings > 0
          ? Math.round((Number(r.total) / totalEarnings) * 10000) / 100
          : 0,
    }));

    // ── Pending earnings with expected clearance ───────────────
    const [pendingTotal, pendingRows] = await Promise.all([
      prisma.commission.count({
        where: { affiliate_user_id: uid, status: "pending" },
      }),
      prisma.commission.findMany({
        where: { affiliate_user_id: uid, status: "pending" },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: "asc" },
        include: {
          order: { select: { order_id: true, amount: true, created_at: true } },
        },
      }),
    ]);

    const pendingEarnings = pendingRows.map((c) => {
      const clearance = new Date(c.order.created_at.getTime() + CLEARANCE_DAYS * 86_400_000);
      return {
        order_id: c.order_id.toString(),
        amount: Number(c.order.amount),
        estimated_commission: Number(c.amount),
        order_date: c.order.created_at.toISOString(),
        expected_clearance_date: clearance.toISOString(),
      };
    });

    const result = {
      earnings_by_period: earningsByPeriod,
      earnings_by_source: earningsBySource,
      pending_earnings: pendingEarnings,
      pending_pagination: {
        page,
        limit,
        total: pendingTotal,
        pages: Math.ceil(pendingTotal / limit),
      },
    };

    const serialized = serialize(result);
    earningsCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: serialized });

      return NextResponse.json({ success: true, data: serialized });
    } catch (err) {
      console.error("[affiliate/earnings/breakdown] error:", err);
      return NextResponse.json(
        { success: false, error: { code: "DATABASE_CONNECTION_ERROR", message: "Internal server error." } },
        { status: 500 }
      );
    }
  });
}
