// ──────────────────────────────────────────────────────────────
// GET /api/affiliate/activities/recent
// ──────────────────────────────────────────────────────────────
// Real-time feed of affiliate-related activities with pagination:
//   Types: click | signup | order | commission_approved | withdrawal_requested | withdrawal_completed
//   Emails are anonymized; amounts included where applicable.
//
// Auth:  Session cookie required.
// Rate:  60/min per IP ("affiliate-activities").
// Note:  This endpoint intentionally avoids aggressive caching
//        (30-second TTL only) to keep the feed "live".
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getAffiliateSettings, anonymizeEmail, formatTimeAgo } from "@/server/lib/affiliate";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

type CacheEntry = { expiresAt: number; value: unknown };
const activitiesCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 1000; // 30 seconds — keep near-live

function toPositiveInt(v: string | null, fallback: number): number {
  if (!v) return fallback;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    // ── Rate limit ─────────────────────────────────────────────
    const rl = checkRateLimit("affiliate-activities", ip);
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
    const page = toPositiveInt(searchParams.get("page"), 1);
    const limit = Math.min(toPositiveInt(searchParams.get("limit"), 20), 100);

    const cacheKey = `${session.userId}:${page}:${limit}`;
    const cached = activitiesCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      const cv = cached.value as Record<string, unknown>;
      return NextResponse.json({ success: true, ...cv, cached: true });
    }

    const uid = BigInt(session.userId);
    const skip = (page - 1) * limit;

    // ── Fetch all activity streams in parallel ─────────────────
    // We union-sort them client-side after fetching a generous window.
    // For production traffic patterns in this system this is acceptable
    // because each stream row count is small. A SQL UNION would require
    // dropping down to raw queries which reduces type safety.
    const WINDOW = skip + limit + 1; // +1 to detect if there are more pages

    const [clicks, referrals, commissions, withdrawals] = await Promise.all([
      prisma.affiliateClick.findMany({
        where: { affiliate_user_id: uid },
        orderBy: { clicked_at: "desc" },
        take: WINDOW,
        select: {
          id: true,
          clicked_at: true,
          source: true,
          campaign: true,
          ip_prefix: true,
          converted: true,
        },
      }),
      prisma.referral.findMany({
        where: { affiliate_user_id: uid },
        orderBy: { referral_date: "desc" },
        take: WINDOW,
        include: { referredUser: { select: { email: true } } },
      }),
      prisma.commission.findMany({
        where: { affiliate_user_id: uid },
        orderBy: { created_at: "desc" },
        take: WINDOW,
        select: { id: true, amount: true, status: true, created_at: true, commission_type: true },
      }),
      prisma.withdrawal.findMany({
        where: { affiliate_user_id: uid },
        orderBy: { requested_at: "desc" },
        take: WINDOW,
        select: { id: true, amount: true, status: true, requested_at: true, processed_at: true, payment_method: true },
      }),
    ]);

    // ── Build unified activity list ────────────────────────────
    type ActivityItem = {
      id: string;
      type: string;
      description: string;
      timestamp: Date;
      amount: number | null;
      status: string;
      referral_email: string | null;
      metadata: Record<string, unknown>;
    };

    const activities: ActivityItem[] = [];

    for (const c of clicks) {
      activities.push({
        id: `click_${c.id.toString()}`,
        type: "click",
        description: c.converted
          ? "Affiliate link clicked — visitor converted to signup"
          : "Affiliate link clicked",
        timestamp: c.clicked_at,
        amount: null,
        status: c.converted ? "converted" : "pending",
        referral_email: null,
        metadata: {
          source: c.source ?? "direct",
          campaign: c.campaign ?? null,
          ip_prefix: c.ip_prefix ?? null,
        },
      });
    }

    for (const r of referrals) {
      activities.push({
        id: `signup_${r.id.toString()}`,
        type: "signup",
        description: "New user signed up via your affiliate link",
        timestamp: r.referral_date,
        amount: null,
        status: r.status,
        referral_email: anonymizeEmail(r.referredUser.email),
        metadata: { referral_status: r.status },
      });
    }

    for (const cm of commissions) {
      const type = cm.status === "approved" ? "commission_approved" : "order";
      activities.push({
        id: `commission_${cm.id.toString()}`,
        type,
        description:
          cm.status === "approved"
            ? `Commission of $${Number(cm.amount).toFixed(2)} approved`
            : `${cm.commission_type === "recurring" ? "Recurring order" : "New order"} — commission pending`,
        timestamp: cm.created_at,
        amount: Number(cm.amount),
        status: cm.status,
        referral_email: null,
        metadata: { commission_type: cm.commission_type },
      });
    }

    for (const w of withdrawals) {
      const type = w.status === "completed" ? "withdrawal_completed" : "withdrawal_requested";
      activities.push({
        id: `withdrawal_${w.id.toString()}`,
        type,
        description:
          w.status === "completed"
            ? `Withdrawal of $${Number(w.amount).toFixed(2)} completed`
            : `Withdrawal of $${Number(w.amount).toFixed(2)} requested via ${w.payment_method ?? "unknown"}`,
        timestamp: w.status === "completed" && w.processed_at ? w.processed_at : w.requested_at,
        amount: Number(w.amount),
        status: w.status,
        referral_email: null,
        metadata: { method: w.payment_method ?? null },
      });
    }

    // Sort descending by timestamp
    activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const now = new Date();
    const pageItems = activities.slice(skip, skip + limit);
    const hasMore = activities.length > skip + limit;

    const formattedActivities = pageItems.map((a) => ({
      id: a.id,
      type: a.type,
      description: a.description,
      timestamp: a.timestamp.toISOString(),
      time_ago: formatTimeAgo(a.timestamp, now),
      amount: a.amount,
      status: a.status,
      referral_email: a.referral_email,
      metadata: a.metadata,
    }));

    // Estimate total (cap at WINDOW for performance)
    const estimatedTotal = hasMore ? skip + limit + 1 : skip + pageItems.length;

    const result = {
      activities: formattedActivities,
      pagination: {
        page,
        limit,
        total: estimatedTotal,
        pages: Math.ceil(estimatedTotal / limit),
        has_more: hasMore,
      },
    };

    const serialized = serialize(result);
    activitiesCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value: { data: serialized },
    });

    return NextResponse.json({ success: true, data: serialized });
  } catch (err) {
    console.error("[affiliate/activities/recent] error:", err);
    return NextResponse.json(
      { success: false, error: { code: "DATABASE_CONNECTION_ERROR", message: "Internal server error." } },
      { status: 500 }
    );
  }
}
