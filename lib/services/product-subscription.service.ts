import { prisma } from "@/server/lib/prisma";
import { addDays, isAfter } from "date-fns";

export type SubscriptionTier = "basic" | "standard" | "premium";
export type SubscriptionStatus = "active" | "expired" | "cancelled" | "pending_activation";

export interface TierFeatures {
  maxVirtualCards: number | null;
  maxPhysicalCards: number | null;
  maxThemes: number;
  maxAssociates: number | null;
  canCreateCompany: boolean;
  canUploadGallery: boolean;
  canManageInquiries: boolean;
  canRealTimeAnalytics: boolean;
  canAffiliate: boolean;
  features: string[];
  pricePerYear: number;
}

export class ProductSubscriptionService {
  private requestId: string;

  constructor(requestId: string) {
    this.requestId = requestId;
  }

  /**
   * Get subscription tier from a product
   */
  async getSubscriptionTierFromProduct(productId: bigint): Promise<SubscriptionTier | null> {
    const product = await prisma.merchandise.findUnique({
      where: { id: productId },
      select: {
        subscription_tier: true,
        subscription_duration_days: true,
      },
    });

    return (product?.subscription_tier as SubscriptionTier) || null;
  }

  /**
   * Activate subscription for a bizcard (after user sets up their card)
   */
  async activateBizcardSubscription(
    bizcardId: bigint,
    userId: bigint,
    productId: bigint
  ): Promise<any> {
    // Verify bizcard belongs to user
    const bizcard = await prisma.bizcard.findFirst({
      where: {
        bizcard_id: bizcardId,
        user_id: userId,
      },
    });

    if (!bizcard) {
      throw new Error(
        `BIZCARD_NOT_FOUND: Bizcard ${bizcardId} not found for user ${userId}`
      );
    }

    // Get product subscription tier
    const product = await prisma.merchandise.findUnique({
      where: { id: productId },
      select: {
        subscription_tier: true,
        subscription_duration_days: true,
      },
    });

    if (!product || !product.subscription_tier) {
      throw new Error(
        `INVALID_PRODUCT: Product ${productId} does not include a subscription`
      );
    }

    const startDate = new Date();
    const expiryDate = addDays(startDate, product.subscription_duration_days || 365);

    const updatedBizcard = await prisma.bizcard.update({
      where: { bizcard_id: bizcardId },
      data: {
        subscription_tier: product.subscription_tier,
        subscription_started_at: startDate,
        subscription_expires_at: expiryDate,
        subscription_status: "active",
        product_id: productId,
      },
    });

    const purchasedTier = String(product.subscription_tier ?? "").trim().toLowerCase();
    let effectiveTier = updatedBizcard.subscription_tier;
    if (purchasedTier === "basic" || purchasedTier === "standard") {
      const { maybeApplyTrialUpgradePremiumBoost } = await import(
        "@/lib/services/premium-experience.service"
      );
      const boost = await maybeApplyTrialUpgradePremiumBoost({
        userId,
        purchasedTier,
      });
      if (boost.applied) {
        effectiveTier = boost.effectiveTier;
      }
    }

    // Log activation
    await this.logSubscriptionEvent(bizcardId, "activated", {
      product_id: productId.toString(),
      tier: effectiveTier,
      purchased_tier: product.subscription_tier,
      start_date: startDate.toISOString(),
      expiry_date: expiryDate.toISOString(),
    });

    return {
      bizcard_id: Number(updatedBizcard.bizcard_id),
      subscription_tier: effectiveTier,
      subscription_started_at: updatedBizcard.subscription_started_at,
      subscription_expires_at: updatedBizcard.subscription_expires_at,
      message: `Subscription activated successfully! Your ${effectiveTier} plan is now active.`,
    };
  }

  /**
   * Get subscription tier features from SubscriptionPlan
   */
  async getTierFeatures(tier: SubscriptionTier): Promise<TierFeatures> {
    const tierData = await prisma.subscriptionPlan.findUnique({
      where: { tier_code: tier },
    });

    if (!tierData) {
      throw new Error(`TIER_NOT_FOUND: Subscription tier ${tier} not found`);
    }

    const features = tierData.features ? JSON.parse(tierData.features) : [];

    return {
      maxVirtualCards: tierData.max_virtual_cards,
      maxPhysicalCards: tierData.max_physical_cards,
      maxThemes: tierData.max_themes || 5,
      maxAssociates: tierData.max_associates,
      canCreateCompany: tierData.can_create_company || false,
      canUploadGallery: tierData.can_upload_gallery || false,
      canManageInquiries: tierData.can_manage_inquiries || false,
      canRealTimeAnalytics: tierData.can_real_time_analytics || false,
      canAffiliate: tierData.can_affiliate || true,
      features: Array.isArray(features) ? features : [],
      pricePerYear: Number(tierData.price_yearly || 0),
    };
  }

  /**
   * Get current subscription for a bizcard
   */
  async getBizcardSubscription(bizcardId: bigint): Promise<any> {
    const bizcard = await prisma.bizcard.findUnique({
      where: { bizcard_id: bizcardId },
      include: {
        user: {
          select: {
            user_id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
      },
    });

    if (!bizcard) {
      throw new Error(`BIZCARD_NOT_FOUND: Bizcard ${bizcardId} not found`);
    }

    const isExpired =
      bizcard.subscription_expires_at &&
      isAfter(new Date(), bizcard.subscription_expires_at)
        ? true
        : false;

    const daysRemaining = bizcard.subscription_expires_at
      ? Math.ceil(
          (bizcard.subscription_expires_at.getTime() - new Date().getTime()) /
            (1000 * 60 * 60 * 24)
        )
      : 0;

    let features: TierFeatures | null = null;
    if (bizcard.subscription_tier) {
      features = await this.getTierFeatures(
        bizcard.subscription_tier as SubscriptionTier
      );
    }

    return {
      bizcard_id: Number(bizcard.bizcard_id),
      bizcard_name: bizcard.bizcard_name,
      subscription_tier: bizcard.subscription_tier,
      subscription_status: isExpired
        ? "expired"
        : bizcard.subscription_status,
      subscription_started_at: bizcard.subscription_started_at,
      subscription_expires_at: bizcard.subscription_expires_at,
      days_remaining: daysRemaining > 0 ? daysRemaining : 0,
      is_expired: isExpired,
      auto_renewal_enabled: bizcard.auto_renewal_enabled,
      features,
    };
  }

  /**
   * Get all subscriptions for a user (across all their bizcards)
   */
  async getUserSubscriptions(userId: bigint): Promise<any[]> {
    const bizcards = await prisma.bizcard.findMany({
      where: {
        user_id: userId,
        subscription_status: { not: "pending_activation" },
      },
      orderBy: { subscription_expires_at: "asc" },
      select: {
        bizcard_id: true,
        bizcard_name: true,
        subscription_tier: true,
        subscription_status: true,
        subscription_expires_at: true,
      },
    });

    return bizcards.map((bizcard) => ({
      bizcard_id: Number(bizcard.bizcard_id),
      bizcard_name: bizcard.bizcard_name,
      subscription_tier: bizcard.subscription_tier,
      subscription_status: bizcard.subscription_status,
      subscription_expires_at: bizcard.subscription_expires_at,
    }));
  }

  /**
   * Renew subscription (manual or auto)
   */
  async renewSubscription(
    bizcardId: bigint,
    userId: bigint,
    paymentMethod?: string,
    paymentTransactionId?: string
  ): Promise<any> {
    // Verify bizcard belongs to user
    const bizcard = await prisma.bizcard.findFirst({
      where: {
        bizcard_id: bizcardId,
        user_id: userId,
      },
    });

    if (!bizcard) {
      throw new Error(
        `BIZCARD_NOT_FOUND: Bizcard ${bizcardId} not found for user ${userId}`
      );
    }

    if (!bizcard.subscription_tier) {
      throw new Error(
        `NO_SUBSCRIPTION: Bizcard ${bizcardId} does not have an active subscription`
      );
    }

    const tierData = await this.getTierFeatures(
      bizcard.subscription_tier as SubscriptionTier
    );
    const previousExpiry = bizcard.subscription_expires_at || new Date();
    const newExpiry = addDays(previousExpiry, 365);

    const updatedBizcard = await prisma.$transaction(async (tx) => {
      const updated = await tx.bizcard.update({
        where: { bizcard_id: bizcardId },
        data: {
          subscription_expires_at: newExpiry,
          subscription_status: "active",
          last_renewal_at: new Date(),
        },
      });

      // Record renewal in history
      await tx.subscriptionRenewalHistory.create({
        data: {
          bizcard_id: bizcardId,
          previous_expiry: previousExpiry,
          new_expiry: newExpiry,
          amount_paid: tierData.pricePerYear,
          payment_method: paymentMethod,
          payment_transaction_id: paymentTransactionId,
          renewed_at: new Date(),
        },
      });

      return updated;
    });

    try {
      const { archiveSubscriptionExpiryWarnings } = await import(
        "@/lib/services/subscription-expiry-reminder.service"
      );
      await archiveSubscriptionExpiryWarnings(userId);
    } catch (error) {
      console.error(
        `[PRODUCT_SUBSCRIPTION] Failed to archive expiry warnings after renew for user ${userId.toString()}:`,
        error,
      );
    }

    return {
      bizcard_id: Number(updatedBizcard.bizcard_id),
      previous_expiry: previousExpiry,
      new_expiry: newExpiry,
      amount_paid: tierData.pricePerYear,
      message: `Subscription renewed successfully until ${newExpiry.toLocaleDateString()}`,
    };
  }

  /**
   * Cancel auto-renewal for a subscription
   */
  async cancelAutoRenewal(bizcardId: bigint, userId: bigint): Promise<any> {
    const bizcard = await prisma.bizcard.findFirst({
      where: {
        bizcard_id: bizcardId,
        user_id: userId,
      },
    });

    if (!bizcard) {
      throw new Error(
        `BIZCARD_NOT_FOUND: Bizcard ${bizcardId} not found for user ${userId}`
      );
    }

    const updatedBizcard = await prisma.bizcard.update({
      where: { bizcard_id: bizcardId },
      data: { auto_renewal_enabled: false },
    });

    await this.logSubscriptionEvent(bizcardId, "auto_renewal_cancelled", {});

    return {
      bizcard_id: Number(updatedBizcard.bizcard_id),
      auto_renewal_enabled: false,
      message: "Auto-renewal has been disabled for this subscription",
    };
  }

  /**
   * Check if a bizcard subscription is active
   */
  async isSubscriptionActive(bizcardId: bigint): Promise<boolean> {
    const bizcard = await prisma.bizcard.findUnique({
      where: { bizcard_id: bizcardId },
      select: {
        subscription_status: true,
        subscription_expires_at: true,
      },
    });

    if (!bizcard) return false;
    if (bizcard.subscription_status !== "active") return false;
    if (
      bizcard.subscription_expires_at &&
      isAfter(new Date(), bizcard.subscription_expires_at)
    ) {
      return false;
    }

    return true;
  }

  /**
   * Check if user has at least one active subscription
   */
  async userHasActiveSubscription(userId: bigint): Promise<boolean> {
    const count = await prisma.bizcard.count({
      where: {
        user_id: userId,
        subscription_status: "active",
        subscription_expires_at: { gt: new Date() },
      },
    });

    return count > 0;
  }

  /**
   * Get user's active subscription tier (primary/highest tier)
   */
  async getUserActiveTier(userId: bigint): Promise<SubscriptionTier | null> {
    const bizcards = await prisma.bizcard.findMany({
      where: {
        user_id: userId,
        subscription_status: "active",
        subscription_expires_at: { gt: new Date() },
      },
      select: { subscription_tier: true },
    });

    if (bizcards.length === 0) return null;

    // Priority: premium > standard > basic
    const tiers: SubscriptionTier[] = ["premium", "standard", "basic"];
    for (const tier of tiers) {
      if (bizcards.some((b) => b.subscription_tier === tier)) {
        return tier;
      }
    }

    return (bizcards[0].subscription_tier as SubscriptionTier) || null;
  }

  /**
   * Expire subscriptions past their expiry date
   */
  async expireOverdueSubscriptions(): Promise<{ processed: number }> {
    const now = new Date();
    const result = await prisma.bizcard.updateMany({
      where: {
        subscription_status: "active",
        subscription_expires_at: { lt: now },
      },
      data: {
        subscription_status: "expired",
      },
    });

    return { processed: result.count };
  }

  /**
   * Log subscription event
   */
  private async logSubscriptionEvent(
    bizcardId: bigint,
    event: string,
    metadata: any
  ): Promise<void> {
    // Audit log using SubscriptionRenewalHistory for event tracking
    // This is a simplified approach; consider adding a dedicated audit log table if needed
    console.log(`[ProductSubscription] Event: ${event} for bizcard ${bizcardId}`, metadata);
  }
}

// Singleton instance
let instance: ProductSubscriptionService;

export function getProductSubscriptionService(
  requestId: string = "default"
): ProductSubscriptionService {
  if (!instance) {
    instance = new ProductSubscriptionService(requestId);
  }
  return instance;
}
