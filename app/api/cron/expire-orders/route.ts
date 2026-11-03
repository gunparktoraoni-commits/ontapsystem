import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/server/lib/notification-cron";
import { expireStalePendingOrders } from "@/server/lib/marketplace/order-expiry";

/**
 * GET /api/cron/expire-orders
 *
 * Cancels unpaid marketplace orders whose Xendit invoice has expired, so the
 * checkout flow can never proceed on an abandoned / incomplete payment. Each
 * candidate is reconciled with Xendit first, so orders that were actually paid
 * (missed webhook) are fulfilled instead of cancelled.
 *
 * Auth: Bearer CRON_SECRET header (same pattern as all other cron routes).
 *
 * Query:
 * - dryRun=true — report candidates without mutating anything
 * - maxAgeHours — override the default staleness window (default 25h)
 * - limit — batch size (default 200, max 1000)
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get("dryRun") === "true";
    const maxAgeHoursRaw = Number(searchParams.get("maxAgeHours") ?? "");
    const limitRaw = Number(searchParams.get("limit") ?? "");

    const result = await expireStalePendingOrders({
      dryRun,
      maxAgeHours:
        Number.isFinite(maxAgeHoursRaw) && maxAgeHoursRaw > 0 ? maxAgeHoursRaw : undefined,
      limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
    });

    return NextResponse.json({ success: true, dryRun, ...result });
  } catch (error) {
    console.error("[CRON_EXPIRE_ORDERS]", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Cron failed",
      },
      { status: 500 },
    );
  }
}
