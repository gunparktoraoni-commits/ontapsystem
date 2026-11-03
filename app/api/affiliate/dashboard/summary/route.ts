// ──────────────────────────────────────────────────────────────
// GET /api/affiliate/dashboard/summary
// ──────────────────────────────────────────────────────────────
// Aggregated overview metrics for the affiliate dashboard header:
//   • Lifetime and period earnings (approved commissions)
//   • Pending earnings (commissions not yet cleared)
//   • Pending client count (referrals with no qualifying order yet)
//   • Conversion rate (clicks → signups within the period)
//   • Total referral count
//   • Withdrawable balance (approved − pending-out)
//   • Optional comparison to previous period
//
// Security:  full session + affiliate-status validation.
// Auth:      Session cookie (session_token).
// Rate:      30/min per IP ("affiliate-dashboard").
// Cache:     Shared cache with 120-second TTL per (userId × timeframe).
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { withPerformanceTracking } from "@/middleware/performance";
import { CACHE_TTL, generateCacheKey, getCached } from "@/lib/cache";
import { parallelFetch } from "@/lib/parallel-fetch";
import {
  getAffiliateSettings,
  computeAvailableBalance,
  resolveAffiliateDateRange,
  formatPctChange,
  safePercent,
} from "@/server/lib/affiliate";

const VALID_TIMEFRAMES = new Set(["month", "quarter", "year", "all"]);

export async function GET(request: NextRequest) {
  return withPerformanceTracking(request, async () => {
    const ip = getClientIp(request);

    try {
    // ── Rate limit ─────────────────────────────────────────────
    const rl = checkRateLimit("affiliate-dashboard", ip);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many requests. Please slow down." } },
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
        { success: false, error: { code: "UNAUTHORIZED_ACCESS", message: "Session expired. Please log in again." } },
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
    const timeframeRaw = (searchParams.get("timeframe") ?? "month").toLowerCase();
    const timeframe = VALID_TIMEFRAMES.has(timeframeRaw) ? timeframeRaw : "month";
    const includeComparison = searchParams.get("include_comparison") !== "false";

    // ── Cache and aggregates ───────────────────────────────────
    const cacheKey = generateCacheKey(
      "affiliate",
      session.userId,
      "dashboard",
      "summary",
      timeframe,
      includeComparison ? "comparison" : "no-comparison"
    );

    const { data, cached } = await getCached(
      cacheKey,
      async () => {
        const range = resolveAffiliateDateRange(timeframe);
        const uid = BigInt(session.userId);

        const aggregates = await parallelFetch({
          lifetimeApproved: () => prisma.commission.aggregate({
            where: { affiliate_user_id: uid, status: { in: ["approved", "paid"] } },
            _sum: { amount: true },
          }),
          periodApproved: () => prisma.commission.aggregate({
            where: {
              affiliate_user_id: uid,
              status: { in: ["approved", "paid"] },
              created_at: { gte: range.start, lte: range.end },
            },
            _sum: { amount: true },
          }),
          prevPeriodApproved: () => prisma.commission.aggregate({
            where: {
              affiliate_user_id: uid,
              status: { in: ["approved", "paid"] },
              created_at: { gte: range.prevStart, lte: range.prevEnd },
            },
            _sum: { amount: true },
          }),
          pendingCommissions: () => prisma.commission.aggregate({
            where: { affiliate_user_id: uid, status: "pending" },
            _sum: { amount: true },
          }),
          totalReferrals: () => prisma.referral.count({ where: { affiliate_user_id: uid } }),
          periodReferrals: () => prisma.referral.count({
            where: {
              affiliate_user_id: uid,
              referral_date: { gte: range.start, lte: range.end },
            },
          }),
          prevPeriodReferrals: () => prisma.referral.count({
            where: {
              affiliate_user_id: uid,
              referral_date: { gte: range.prevStart, lte: range.prevEnd },
            },
          }),
          periodClicks: () => prisma.affiliateClick.count({
            where: {
              affiliate_user_id: uid,
              clicked_at: { gte: range.start, lte: range.end },
            },
          }),
          prevPeriodClicks: () => prisma.affiliateClick.count({
            where: {
              affiliate_user_id: uid,
              clicked_at: { gte: range.prevStart, lte: range.prevEnd },
            },
          }),
          pendingClients: () => prisma.referral.count({
            where: { affiliate_user_id: uid, status: "pending" },
          }),
          availableBalance: () => computeAvailableBalance(session.userId),
        });

        const lifetimeTotal = Number(aggregates.lifetimeApproved._sum.amount ?? 0);
        const periodTotal = Number(aggregates.periodApproved._sum.amount ?? 0);
        const prevPeriodTotal = Number(aggregates.prevPeriodApproved._sum.amount ?? 0);
        const pendingTotal = Number(aggregates.pendingCommissions._sum.amount ?? 0);

        const conversionRate = safePercent(aggregates.periodReferrals, aggregates.periodClicks);
        const prevConversionRate = safePercent(aggregates.prevPeriodReferrals, aggregates.prevPeriodClicks);

        const payload: Record<string, unknown> = {
          total_earnings_lifetime: lifetimeTotal,
          total_earnings_this_period: periodTotal,
          total_earnings_pending: pendingTotal,
          pending_clients_count: aggregates.pendingClients,
          conversion_rate: conversionRate,
          total_referrals_count: aggregates.totalReferrals,
          withdrawable_amount: aggregates.availableBalance,
          currency: "USD",
          timeframe,
          period: {
            start: range.start.toISOString(),
            end: range.end.toISOString(),
          },
        };

        if (includeComparison && timeframe !== "all") {
          payload.comparison = {
            earnings_change: formatPctChange(periodTotal, prevPeriodTotal),
            referrals_change: formatPctChange(aggregates.periodReferrals, aggregates.prevPeriodReferrals),
            conversion_rate_change: formatPctChange(conversionRate, prevConversionRate),
            previous_period_earnings: prevPeriodTotal,
            previous_period_referrals: aggregates.prevPeriodReferrals,
          };
        }

        return payload;
      },
      CACHE_TTL.AFFILIATE_SUMMARY
    );

      return NextResponse.json({ success: true, data, cached });
    } catch (err) {
      console.error("[affiliate/dashboard/summary] error:", err);
      return NextResponse.json(
        { success: false, error: { code: "DATABASE_CONNECTION_ERROR", message: "Internal server error." } },
        { status: 500 }
      );
    }
  });
}
