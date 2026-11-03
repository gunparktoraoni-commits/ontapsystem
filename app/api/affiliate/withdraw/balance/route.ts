// ──────────────────────────────────────────────────────────────
// GET /api/affiliate/withdraw/balance
// ──────────────────────────────────────────────────────────────
// Returns the affiliate's withdrawable balance and withdrawal history.
//   • available_balance  — approved − pending-withdrawals (live calc)
//   • pending_clearance  — commissions in "pending" status
//   • minimum_withdrawal — from AffiliateSettings.payment_threshold
//   • meets_threshold    — boolean flag for UI gating
//   • withdrawal_methods — static list of supported methods
//   • recent_withdrawals — last 10, with sensitive details masked
//
// Auth:  Session cookie required.
// Rate:  60/min per IP ("affiliate-balance").
// Cache: 1-minute per userId (balance can change frequently).
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  getAffiliateSettings,
  computeAvailableBalance,
  computePendingClearance,
} from "@/server/lib/affiliate";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

type CacheEntry = { expiresAt: number; value: unknown };
const balanceCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 1000; // 1 minute

// ── Static withdrawal method catalog ─────────────────────────
const WITHDRAWAL_METHODS = [
  {
    id: "paypal",
    name: "PayPal",
    description: "Transfer to your PayPal account",
    min_amount: 10,
    processing_time: "2–3 business days",
    fee: 0,
  },
  {
    id: "bank_transfer",
    name: "Bank Transfer",
    description: "Direct deposit to your bank account",
    min_amount: 50,
    processing_time: "5–7 business days",
    fee: 1.5,
  },
  {
    id: "gcash",
    name: "GCash",
    description: "Transfer to your GCash mobile wallet",
    min_amount: 10,
    processing_time: "1 business day",
    fee: 0,
  },
];

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    // ── Rate limit ─────────────────────────────────────────────
    const rl = checkRateLimit("affiliate-balance", ip);
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

    // ── Cache check ────────────────────────────────────────────
    const cacheKey = `${session.userId}`;
    const cached = balanceCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return NextResponse.json({ success: true, data: cached.value, cached: true });
    }

    const uid = BigInt(session.userId);

    // ── Parallel balance + withdrawal history ──────────────────
    const [availableBalance, pendingClearance, recentWithdrawals] =
      await Promise.all([
        computeAvailableBalance(session.userId),
        computePendingClearance(session.userId),
        prisma.withdrawal.findMany({
          where: { affiliate_user_id: uid },
          orderBy: { requested_at: "desc" },
          take: 10,
          select: {
            id: true,
            amount: true,
            currency: true,
            status: true,
            payment_method: true,
            reference_number: true,
            requested_at: true,
            processed_at: true,
          },
        }),
      ]);

    const minimumWithdrawal = Number(settings.payment_threshold);
    const meetsThreshold = availableBalance >= minimumWithdrawal;

    // Determine next scheduled payout date (1st of following month)
    const now = new Date();
    const nextPayoutDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
    );

    const withdrawalList = recentWithdrawals.map((w) => ({
      id: w.id.toString(),
      amount: Number(w.amount),
      currency: w.currency,
      status: w.status,
      requested_date: w.requested_at.toISOString(),
      processed_date: w.processed_at?.toISOString() ?? null,
      method: w.payment_method ?? "unknown",
      // Mask reference: show last 4 chars if available
      reference: w.reference_number
        ? `****${w.reference_number.slice(-4)}`
        : null,
    }));

    const data = {
      available_balance: availableBalance,
      pending_clearance: pendingClearance,
      minimum_withdrawal: minimumWithdrawal,
      meets_threshold: meetsThreshold,
      next_payout_date: nextPayoutDate.toISOString(),
      withdrawal_methods: WITHDRAWAL_METHODS,
      recent_withdrawals: withdrawalList,
    };

    const serialized = serialize(data);
    balanceCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: serialized });

    return NextResponse.json({ success: true, data: serialized });
  } catch (err) {
    console.error("[affiliate/withdraw/balance] error:", err);
    return NextResponse.json(
      { success: false, error: { code: "DATABASE_CONNECTION_ERROR", message: "Internal server error." } },
      { status: 500 }
    );
  }
}
