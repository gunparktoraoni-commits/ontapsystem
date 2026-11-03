import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getUserBizcardLimits } from "@/lib/bizcard/limits";
import { requireSession, serialize } from "../../_helpers";

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("user-bizcards-upgrade-needed", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  try {
    const limits = await getUserBizcardLimits(auth.userId);

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          needs_upgrade: limits.isLimitReached,
          current_tier: limits.tier,
          current_bizcards: limits.currentBizcards,
          max_allowed: Number.isFinite(limits.maxBizcards) ? limits.maxBizcards : "unlimited",
          can_create_more: limits.canCreateVirtual,
          suggested_tier: limits.tier === "free_trial" ? "basic" : "premium",
          features_unlocked: [
            "More bizcards",
            "Priority support",
            "Advanced analytics",
            "Custom branding",
          ],
          upgrade_options: {
            monthly: {
              price: 29.99,
              url: "/checkout?plan=premium&interval=month",
            },
            yearly: {
              price: 299.99,
              url: "/checkout?plan=premium&interval=year",
              savings: "20%",
            },
          },
        },
      })
    );
  } catch (error) {
    console.error("[user/bizcards/subscription/upgrade-needed GET]", error);
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
