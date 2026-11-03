import { prisma } from "@/server/lib/prisma";
import { subscriptionService } from "@/lib/services/subscription.service";

// New tier codes matching the subscription system
export type BizcardTier = "free_trial" | "basic" | "standard" | "premium" | "enterprise" | "none";

export interface BizcardLimitState {
  tier: BizcardTier;
  maxVirtualCards: number;
  maxPhysicalCards: number;
  currentVirtualCards: number;
  currentPhysicalCards: number;
  remainingVirtual: number;
  remainingPhysical: number;
  isVirtualLimitReached: boolean;
  isPhysicalLimitReached: boolean;
  canCreateVirtual: boolean;
  canCreatePhysical: boolean;
  upgradeRequired: boolean;
  subscriptionStatus: string;
  subscriptionExpiresAt: Date | null;
  isLimitReached: boolean;
  currentBizcards: number;
  maxBizcards: number;
}

export function buildBizcardLimitState(params: {
  tier: BizcardTier;
  currentVirtualCards: number;
  currentPhysicalCards: number;
  maxVirtualCards: number;
  maxPhysicalCards: number;
  subscriptionStatus?: string;
  subscriptionExpiresAt?: Date | null;
}): BizcardLimitState {
  const isUnlimitedVirtual = params.maxVirtualCards === null || params.maxVirtualCards === -1;
  const isUnlimitedPhysical = params.maxPhysicalCards === null || params.maxPhysicalCards === -1;

  const isVirtualLimitReached = !isUnlimitedVirtual && params.currentVirtualCards >= params.maxVirtualCards;
  const isPhysicalLimitReached = !isUnlimitedPhysical && params.currentPhysicalCards >= params.maxPhysicalCards;

  return {
    tier: params.tier,
    maxVirtualCards: isUnlimitedVirtual ? -1 : params.maxVirtualCards,
    maxPhysicalCards: isUnlimitedPhysical ? -1 : params.maxPhysicalCards,
    currentVirtualCards: params.currentVirtualCards,
    currentPhysicalCards: params.currentPhysicalCards,
    remainingVirtual: isUnlimitedVirtual ? -1 : Math.max(0, params.maxVirtualCards - params.currentVirtualCards),
    remainingPhysical: isUnlimitedPhysical ? -1 : Math.max(0, params.maxPhysicalCards - params.currentPhysicalCards),
    isVirtualLimitReached,
    isPhysicalLimitReached,
    canCreateVirtual: !isVirtualLimitReached,
    canCreatePhysical: !isPhysicalLimitReached,
    upgradeRequired: isVirtualLimitReached || isPhysicalLimitReached,
    subscriptionStatus: params.subscriptionStatus ?? "inactive",
    subscriptionExpiresAt: params.subscriptionExpiresAt ?? null,
    isLimitReached: isVirtualLimitReached || isPhysicalLimitReached,
    currentBizcards: params.currentVirtualCards + params.currentPhysicalCards,
    maxBizcards: isUnlimitedVirtual ? -1 : params.maxVirtualCards,
  };
}

/**
 * Get user's primary active subscription tier from their bizcards
 */
async function getUserPrimarySubscriptionTier(userId: bigint): Promise<{
  tier: string;
  status: string;
  expiresAt: Date | null;
} | null> {
  // Get all active bizcard subscriptions
  const bizcards = await prisma.bizcard.findMany({
    where: {
      user_id: userId,
      subscription_status: "active",
      subscription_expires_at: { gt: new Date() },
    },
    select: {
      subscription_tier: true,
      subscription_expires_at: true,
    },
    orderBy: { subscription_expires_at: "asc" },
  });

  if (bizcards.length === 0) {
    return null;
  }

  // Determine highest tier priority: premium > standard > basic
  const tierPriority: Record<string, number> = {
    premium: 3,
    standard: 2,
    basic: 1,
  };

  const highestTier = bizcards.reduce((max, current) => {
    const currentPriority = tierPriority[current.subscription_tier || ""] || 0;
    const maxPriority = tierPriority[max.subscription_tier || ""] || 0;
    return currentPriority > maxPriority ? current : max;
  });

  return {
    tier: highestTier.subscription_tier || "basic",
    status: "active",
    expiresAt: highestTier.subscription_expires_at,
  };
}

export async function getUserBizcardLimits(userId: bigint): Promise<BizcardLimitState> {
  // Get user's primary subscription from their bizcards
  const userSubscription = await getUserPrimarySubscriptionTier(userId);

  let tier: BizcardTier = "none";
  let features;
  let subscriptionStatus = "inactive";
  let subscriptionExpiresAt: Date | null = null;

  if (userSubscription) {
    tier = userSubscription.tier as BizcardTier;
    subscriptionStatus = userSubscription.status;
    subscriptionExpiresAt = userSubscription.expiresAt;

    // Get features from SubscriptionPlan using the bizcard tier
    const plan = await prisma.subscriptionPlan.findUnique({
      where: { tier_code: tier },
    });

    if (plan) {
      features = {
        maxVirtualCards: plan.max_virtual_cards ?? 0,
        maxPhysicalCards: plan.max_physical_cards ?? 0,
        maxThemes: plan.max_themes || 5,
        maxAssociates: plan.max_associates,
        canCreateCompany: plan.can_create_company || false,
        canUploadGallery: plan.can_upload_gallery || false,
        canManageInquiries: plan.can_manage_inquiries || false,
        canRealTimeAnalytics: plan.can_real_time_analytics || false,
        canAffiliate: plan.can_affiliate || true,
        canDashboard: plan.can_dashboard || true,
      };
    }
  }

  // Fall back to legacy subscription service if no bizcard subscription found
  if (!features) {
    features = await subscriptionService.getTierFeatures(userId);
    if (tier === "none") {
      const legacyStatus = await subscriptionService.getSubscriptionStatus(userId);
      tier = (legacyStatus.tier as BizcardTier) ?? "none";
      subscriptionStatus = legacyStatus.status;
      subscriptionExpiresAt = legacyStatus.expiresAt;
    }
  }

  // Count current bizcards
  const [virtualCount, physicalCount] = await Promise.all([
    prisma.bizcard.count({
      where: { user_id: userId, bizcard_type: "virtual", deactivated_flag: false },
    }),
    prisma.bizcard.count({
      where: { user_id: userId, bizcard_type: "physical", deactivated_flag: false },
    }),
  ]);

  return buildBizcardLimitState({
    tier,
    currentVirtualCards: virtualCount,
    currentPhysicalCards: physicalCount,
    maxVirtualCards: features.maxVirtualCards,
    maxPhysicalCards: features.maxPhysicalCards,
    subscriptionStatus,
    subscriptionExpiresAt,
  });
}

export async function getNextTierDetails(currentTier: BizcardTier): Promise<{
  name: string;
  tierCode: string;
  maxVirtualCards: number | "unlimited";
  maxPhysicalCards: number | "unlimited";
  priceMonthly: number;
  upgradeUrl: string;
}> {
  const order: BizcardTier[] = ["none", "free_trial", "basic", "standard", "premium"];
  const currentIndex = order.indexOf(currentTier);
  const next = order[Math.min(currentIndex + 1, order.length - 1)] ?? "premium";

  const plan = await prisma.subscriptionPlan.findUnique({
    where: { tier_code: next },
  });

  const maxVirtual = plan?.max_virtual_cards ?? 0;
  const maxPhysical = plan?.max_physical_cards ?? 0;

  return {
    name: plan?.name ?? next.charAt(0).toUpperCase() + next.slice(1),
    tierCode: next,
    maxVirtualCards: maxVirtual === null ? "unlimited" : maxVirtual,
    maxPhysicalCards: maxPhysical === null ? "unlimited" : maxPhysical,
    priceMonthly: Number(plan?.price_monthly ?? 0),
    upgradeUrl: "/user/subscription/upgrade",
  };
}
