import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getNextTierDetails, getUserBizcardLimits } from "@/lib/bizcard/limits";
import { requireSession, serialize } from "../../_helpers";

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("user-bizcards-subscription-limits", ip);
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
    const [activeCount, deactivatedCount, nextTier] = await Promise.all([
      prisma.bizcard.count({ where: { user_id: auth.userId, deactivated_flag: false } }),
      prisma.bizcard.count({ where: { user_id: auth.userId, deactivated_flag: true } }),
      getNextTierDetails(limits.tier),
    ]);

    const max = limits.maxBizcards;
    const isUnlimited = !Number.isFinite(max);
    const availableSlots = isUnlimited ? "unlimited" : Math.max(0, max - activeCount);

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          subscription: {
            tier: limits.tier,
            status: limits.subscriptionStatus,
            expires_at: limits.subscriptionExpiresAt,
            billing_cycle: null,
          },
          limits: {
            max_bizcards: isUnlimited ? "unlimited" : max,
            current_bizcards: activeCount,
            available_slots: availableSlots,
            is_limit_reached: limits.isLimitReached,
            can_create_more: limits.canCreateVirtual,
            upgrade_required: limits.upgradeRequired,
          },
          next_tier: {
            name: nextTier.name,
            max_bizcards: nextTier.maxVirtualCards,
            price_monthly: nextTier.priceMonthly,
            upgrade_url: nextTier.upgradeUrl,
          },
          usage: {
            bizcards_created: activeCount + deactivatedCount,
            bizcards_active: activeCount,
            bizcards_archived: deactivatedCount,
            percentage_used: isUnlimited || max === 0 ? 0 : Math.round((activeCount / max) * 100),
          },
        },
      })
    );
  } catch (error) {
    console.error("[user/bizcards/subscription/limits GET]", error);
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
