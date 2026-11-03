import { NextRequest, NextResponse } from "next/server";
import { withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  listSuperAdminSubscriptionTransactions,
  type SuperAdminSubscriptionTransactionType,
} from "@/server/lib/superadmin/subscription-transactions";
import { getClientIp } from "@/server/lib/auth";

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export const GET = withSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId } = context;

  const rateCheck = checkRateLimit("superadmin-subscription-transactions", getClientIp(req));
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SUPERADMIN_SUBSCRIPTION_TX_RATE_LIMITED",
          tag: "[SUPERADMIN_SUBSCRIPTION_TX]",
          message: "Too many subscription transaction requests. Please slow down.",
        },
      },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } },
    );
  }

  const searchParams = req.nextUrl.searchParams;
  const type = (searchParams.get("type") ?? "all").trim().toLowerCase();
  const allowedTypes = new Set(["all", "renewal", "upgrade", "downgrade", "cancellation"]);
  if (!allowedTypes.has(type)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SUPERADMIN_SUBSCRIPTION_TX_INVALID_TYPE",
          tag: "[SUPERADMIN_SUBSCRIPTION_TX]",
          message: "Invalid transaction type filter.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const data = await listSuperAdminSubscriptionTransactions({
      page: parsePositiveInt(searchParams.get("page"), 1, 1, 100000),
      limit: parsePositiveInt(searchParams.get("limit"), 20, 1, 100),
      type: type as "all" | SuperAdminSubscriptionTransactionType,
      search: searchParams.get("search")?.trim() || undefined,
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
    });

    return NextResponse.json({
      success: true,
      data,
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[SUPERADMIN_SUBSCRIPTION_TX] Failed to fetch transactions", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SUPERADMIN_SUBSCRIPTION_TX_FETCH_FAILED",
          tag: "[SUPERADMIN_SUBSCRIPTION_TX]",
          message: "Failed to fetch subscription transactions.",
        },
      },
      { status: 500 },
    );
  }
}, { errorMode: "superadmin" });
