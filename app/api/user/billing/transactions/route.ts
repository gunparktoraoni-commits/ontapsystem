import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { withPerformanceTracking } from "@/middleware/performance";
import {
  fetchUserBillingHistory,
  type BillingTxTypeFilter,
} from "@/server/lib/billing/history";

function serialize(obj: unknown): unknown {
  return JSON.parse(JSON.stringify(obj, (_, value) => (typeof value === "bigint" ? value.toString() : value)));
}

function parseIntParam(raw: string | null, fallback: number, max?: number): number {
  const n = raw ? Number(raw) : fallback;
  const parsed = Number.isInteger(n) && n > 0 ? n : fallback;
  return max ? Math.min(parsed, max) : parsed;
}

async function requireSession(request: NextRequest) {
  const resolved = await resolveRequestSession(request);
  if (!resolved.session) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Authentication required.", requiresAuth: true }, { status: 401 }),
    };
  }
  return { ok: true as const, session: resolved.session };
}

export async function GET(request: NextRequest) {
  return withPerformanceTracking(request, async () => {
    const ip = getClientIp(request);
    const rl = checkRateLimit("marketplace-purchases-list", ip);
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429 });
    }

    const auth = await requireSession(request);
    if (!auth.ok) return auth.response;

    const q = request.nextUrl.searchParams;
    const page = parseIntParam(q.get("page"), 1);
    const limit = parseIntParam(q.get("limit"), 20, 100);
    const type = (q.get("type") ?? "all").toLowerCase() as BillingTxTypeFilter;
    const status = (q.get("status") ?? "all").toLowerCase();
    const fromDate = q.get("from_date");
    const toDate = q.get("to_date");

    const allowedTypes: BillingTxTypeFilter[] = [
      "all",
      "subscription",
      "physical_card",
      "theme",
      "promo",
      "subscription_change",
    ];
    if (!allowedTypes.includes(type)) {
      return NextResponse.json({ success: false, error: "Invalid type filter." }, { status: 422 });
    }

    const userId = BigInt(auth.session.userId);

    try {
      const result = await fetchUserBillingHistory(userId, {
        page,
        limit,
        type,
        status,
        fromDate,
        toDate,
      });

      return NextResponse.json(
        serialize({
          success: true,
          data: {
            transactions: result.transactions,
            pagination: result.pagination,
            summary: result.summary,
          },
        }),
      );
    } catch (err) {
      console.error("[BILLING_API] BILLING_TRANSACTIONS_FETCH_FAILED", err);
      return NextResponse.json(
        {
          success: false,
          error: "Failed to load billing history.",
          code: "BILLING_TRANSACTIONS_FETCH_FAILED",
          tag: "[BILLING_API]",
        },
        { status: 500 },
      );
    }
  });
}
