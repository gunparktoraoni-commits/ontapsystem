import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/server/lib/notification-cron";
import { runTrialUpgradePromo } from "@/lib/services/trial-upgrade-promo.service";

/**
 * GET /api/cron/trial-upgrade-promo
 *
 * Email expired free-trial users: purchasing Basic or Standard BizCard unlocks
 * 1 month of Premium features.
 *
 * Query: dryRun=true | limit (default 40, max 100)
 * Suggested schedule: daily 0 9 * * *
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get("dryRun") === "true";
    const limitRaw = Number(searchParams.get("limit") ?? "40");
    const limit = Number.isFinite(limitRaw) ? limitRaw : 40;

    const result = await runTrialUpgradePromo(new Date(), { limit, dryRun });

    return NextResponse.json({
      success: true,
      message: dryRun
        ? `Dry run: ${result.candidates} candidates eligible for trial upgrade promo.`
        : `Sent ${result.sent} trial upgrade promo emails (${result.candidates} eligible in batch).`,
      data: result,
    });
  } catch (error) {
    console.error("[trial-upgrade-promo cron]", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Cron failed",
        tag: "[CRON_TRIAL_UPGRADE_PROMO]",
        code: "TRIAL_UPGRADE_PROMO_FAILED",
      },
      { status: 500 },
    );
  }
}
