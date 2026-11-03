// ──────────────────────────────────────────────────────────────
// GET /api/affiliate/referrals/clients
// ──────────────────────────────────────────────────────────────
// Returns paginated list of referred clients with:
//   • Status breakdown (new_this_month, one_time, recurring, churned)
//   • Anonymized email addresses
//   • Per-client order stats and commission earned
//   • Average order value and lifetime value aggregates
//
// Auth:   Session cookie required.
// Rate:   30/min per IP ("affiliate-referrals").
// Cache:  5-minute in-memory cache per (userId × page × limit × status).
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getAffiliateSettings, anonymizeEmail } from "@/server/lib/affiliate";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

const ALLOWED_STATUSES = new Set(["pending", "active", "churned"]);

function toPositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

// ── 5-minute cache ────────────────────────────────────────────
type CacheEntry = { expiresAt: number; value: unknown };
const referralsCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    // ── Rate limit ─────────────────────────────────────────────
    const rl = checkRateLimit("affiliate-referrals", ip);
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
    const statusFilter = (searchParams.get("status") ?? "").toLowerCase();
    const page = toPositiveInt(searchParams.get("page"), 1);
    const limit = Math.min(toPositiveInt(searchParams.get("limit"), 20), 100);
    const skip = (page - 1) * limit;

    if (statusFilter && !ALLOWED_STATUSES.has(statusFilter)) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_PARAMETER", message: "Invalid status. Allowed: pending, active, churned." } },
        { status: 422 }
      );
    }

    // ── Cache check ────────────────────────────────────────────
    const cacheKey = `${session.userId}:${statusFilter}:${page}:${limit}`;
    const cached = referralsCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      const cv = cached.value as Record<string, unknown>;
      return NextResponse.json({ success: true, ...cv, cached: true });
    }

    const uid = BigInt(session.userId);

    // ── Parallel: totals + status breakdown + client list ──────
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const whereBase = {
      affiliate_user_id: uid,
      ...(statusFilter ? { status: statusFilter } : {}),
    };

    const [
      totalClients,
      activeClients,
      newThisMonth,
      churned,
      lifetimeValueResult,
      referrals,
    ] = await Promise.all([
      prisma.referral.count({ where: { affiliate_user_id: uid } }),
      prisma.referral.count({ where: { affiliate_user_id: uid, status: "active" } }),
      prisma.referral.count({
        where: { affiliate_user_id: uid, referral_date: { gte: monthStart } },
      }),
      prisma.referral.count({ where: { affiliate_user_id: uid, status: "churned" } }),
      prisma.referral.aggregate({
        where: { affiliate_user_id: uid },
        _sum: { lifetime_value: true },
      }),
      prisma.referral.findMany({
        where: whereBase,
        skip,
        take: limit,
        orderBy: { referral_date: "desc" },
        include: {
          referredUser: {
            select: {
              email: true,
              created_at: true,
            },
          },
        },
      }),
    ]);

    // Gather commission totals per referral in one query (group by affiliate)
    const referredUserIds = referrals.map((r) => r.referred_user_id);
    const commissionTotals = await prisma.commission.groupBy({
      by: ["referred_user_id"],
      where: {
        affiliate_user_id: uid,
        referred_user_id: { in: referredUserIds },
        status: { in: ["approved", "paid"] },
      },
      _sum: { amount: true },
      _count: { order_id: true },
    });
    const commissionMap = new Map<bigint, { amount: number; orderCount: number }>();
    for (const row of commissionTotals) {
      commissionMap.set(row.referred_user_id, {
        amount: Number(row._sum.amount ?? 0),
        orderCount: row._count.order_id,
      });
    }

    const clientList = referrals.map((r) => {
      const cm = commissionMap.get(r.referred_user_id);
      return {
        id: r.id.toString(),
        email: anonymizeEmail(r.referredUser.email),
        joined_date: r.referredUser.created_at.toISOString(),
        first_order_date: r.conversion_date?.toISOString() ?? null,
        total_orders: cm?.orderCount ?? 0,
        total_spent: Number(r.lifetime_value),
        commission_earned: cm?.amount ?? 0,
        status: r.status,
        last_activity: r.conversion_date?.toISOString() ?? r.referral_date.toISOString(),
      };
    });

    const lifetimeValue = Number(lifetimeValueResult._sum.lifetime_value ?? 0);
    const avgOrderValue =
      clientList.length > 0
        ? lifetimeValue / Math.max(1, clientList.reduce((s, c) => s + c.total_orders, 0))
        : 0;

    const responseData = {
      total_clients: totalClients,
      active_clients: activeClients,
      clients_by_status: {
        new_this_month: newThisMonth,
        one_time: await prisma.referral.count({
          where: { affiliate_user_id: uid, status: "active", lifetime_value: { gt: 0 } },
        }),
        recurring: 0, // requires order-count logic — surfaced via commissions endpoint
        churned,
      },
      average_order_value: Math.round(avgOrderValue * 100) / 100,
      lifetime_value: lifetimeValue,
      client_list: clientList,
      pagination: {
        page,
        limit,
        total: totalClients,
        pages: Math.ceil(totalClients / limit),
      },
    };

    const serialized = serialize(responseData);
    referralsCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: { data: serialized } });

    return NextResponse.json({ success: true, data: serialized });
  } catch (err) {
    console.error("[affiliate/referrals/clients] error:", err);
    return NextResponse.json(
      { success: false, error: { code: "DATABASE_CONNECTION_ERROR", message: "Internal server error." } },
      { status: 500 }
    );
  }
}
