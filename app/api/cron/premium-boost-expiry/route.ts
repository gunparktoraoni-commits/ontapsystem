import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/server/lib/notification-cron";
import { expirePremiumFeatureBoosts } from "@/lib/services/premium-experience.service";

/**
 * GET /api/cron/premium-boost-expiry
 *
 * Restores bizcard tiers when exclusive / trial-upgrade premium boosts end.
 * Query: dryRun=true | limit (default 50, max 200)
 * Suggested schedule: hourly 20 * * * *
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get("dryRun") === "true";
    const limitRaw = Number(searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;

    const result = await expirePremiumFeatureBoosts(new Date(), { limit, dryRun });

    return NextResponse.json({
      success: true,
      message: dryRun
        ? `Dry run: ${result.expired} expired premium boosts pending restore.`
        : `Expired ${result.expired} premium boosts; restored ${result.restoredCards} bizcard tiers.`,
      data: result,
    });
  } catch (error) {
    console.error("[premium-boost-expiry cron]", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Cron failed",
        tag: "[CRON_PREMIUM_BOOST_EXPIRY]",
        code: "PREMIUM_BOOST_EXPIRY_FAILED",
      },
      { status: 500 },
    );
  }
}
