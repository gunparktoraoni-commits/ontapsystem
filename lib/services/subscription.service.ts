// lib/backend/services/subscription.service.ts
import { prisma } from "@/server/lib/prisma";
import { Prisma } from "@prisma/client";
import { updateUserSubscriptionFlags } from "@/lib/auth/subscription-guards";
import {
  SubscriptionAccessService,
  type AccessReason,
  type ExpirationKind,
} from "@/lib/services/subscription-access.service";

type ExpiringSubscription = Prisma.BizcardSubscriptionGetPayload<{
  include: { plan: true; bizcard: true };
}>;

export interface TierFeatures {
  maxVirtualCards: number;
  maxPhysicalCards: number;
  maxThemes: number;
  maxAssociates: number;
  canCreateCompany: boolean;
  canUploadGallery: boolean;
  canManageInquiries: boolean;
  canRealTimeAnalytics: boolean;
  canAffiliate: boolean;
  canDashboard: boolean;
}

export interface SubscriptionStatus {
  tier: string;
  status: "active" | "expired" | "cancelled" | "pending";
  expiresAt: Date | null;
  daysRemaining: number;
  isExpired: boolean;
  isTrial: boolean;
  features: TierFeatures;
  accessReason: AccessReason;
  trialExpired: boolean;
  subscriptionExpired: boolean;
  expirationKind: ExpirationKind;
}

export interface CardLimitCheck {
  allowed: boolean;
  current: number;
  max: number;
}

export class SubscriptionService {
  static DEFAULT_GRACE_DAYS = Number(process.env.SUBSCRIPTION_EXPIRY_GRACE_DAYS ?? 3);

  private async getActiveSubscription(userId: bigint) {
    return prisma.bizcardSubscription.findFirst({
      where: {
        bizcard: { user_id: userId, deactivated_flag: false },
        status: "active",
      },
      include: { plan: true },
      orderBy: { expires_at: "desc" },
    });
  }

  private async getActiveSubscriptions(userId: bigint) {
    return prisma.bizcardSubscription.findMany({
      where: {
        bizcard: { user_id: userId, deactivated_flag: false },
        status: "active",
      },
      include: { plan: true },
    });
  }

  private async isPrivilegedPremiumUser(userIdBigInt: bigint): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { user_id: userIdBigInt },
      select: { role: true },
    });
    const role = String(user?.role ?? "")
      .trim()
      .toLowerCase();
    return role === "dev" || role === "super_admin";
  }

  /** @deprecated Use isPrivilegedPremiumUser — kept as alias for internal call sites. */
  private async isDevUser(userIdBigInt: bigint): Promise<boolean> {
    return this.isPrivilegedPremiumUser(userIdBigInt);
  }

  private getDevFeatures(): TierFeatures {
    return {
      maxVirtualCards: Number.POSITIVE_INFINITY,
      maxPhysicalCards: Number.POSITIVE_INFINITY,
      maxThemes: Number.POSITIVE_INFINITY,
      maxAssociates: Number.POSITIVE_INFINITY,
      canCreateCompany: true,
      canUploadGallery: true,
      canManageInquiries: true,
      canRealTimeAnalytics: true,
      canAffiliate: true,
      canDashboard: true,
    };
  }

  private getExpiredFeatures(): TierFeatures {
    return {
      maxVirtualCards: 0,
      maxPhysicalCards: 0,
      maxThemes: 0,
      maxAssociates: 0,
      canCreateCompany: false,
      canUploadGallery: false,
      canManageInquiries: false,
      canRealTimeAnalytics: false,
      canAffiliate: false,
      canDashboard: true,
    };
  }

  private getDefaultFeatures(): TierFeatures {
    return { ...this.getExpiredFeatures() };
  }

  private planToFeatures(plan: {
    max_virtual_cards: number | null;
    max_physical_cards: number | null;
    max_themes: number | null;
    max_associates: number | null;
    can_create_company: boolean | null;
    can_upload_gallery: boolean | null;
    can_manage_inquiries: boolean | null;
    can_real_time_analytics: boolean | null;
    can_affiliate: boolean | null;
    can_dashboard: boolean | null;
  }): TierFeatures {
    return {
      maxVirtualCards: plan.max_virtual_cards ?? 0,
      maxPhysicalCards: plan.max_physical_cards ?? 0,
      maxThemes: plan.max_themes ?? 5,
      maxAssociates: plan.max_associates ?? 15,
      canCreateCompany: plan.can_create_company ?? false,
      canUploadGallery: plan.can_upload_gallery ?? false,
      canManageInquiries: plan.can_manage_inquiries ?? false,
      canRealTimeAnalytics: plan.can_real_time_analytics ?? false,
      canAffiliate: plan.can_affiliate ?? true,
      canDashboard: plan.can_dashboard ?? true,
    };
  }

  private async getTrialPlanFeatures(): Promise<TierFeatures> {
    const plan = await prisma.subscriptionPlan.findUnique({
      where: { tier_code: "free_trial" },
    });
    if (!plan) return this.getDefaultFeatures();
    return this.planToFeatures(plan);
  }

  private async getTierFeaturesByCode(tierCode: string): Promise<TierFeatures> {
    const plan = await prisma.subscriptionPlan.findUnique({
      where: { tier_code: tierCode },
    });
    if (!plan) return this.getDefaultFeatures();
    return this.planToFeatures(plan);
  }

  private buildExpirationFields(accessReason: AccessReason, expirationKind?: ExpirationKind) {
    return {
      accessReason,
      trialExpired: accessReason === "trial_expired",
      subscriptionExpired: accessReason === "subscription_expired",
      expirationKind: expirationKind ?? null,
    };
  }

  async initializeFreeTrial(userId: string | bigint, bizcardSerialId: string): Promise<void> {
    const userIdBigInt = typeof userId === "string" ? BigInt(userId) : userId;

    const user = await prisma.user.findUnique({
      where: { user_id: userIdBigInt },
      select: { is_trial_used: true },
    });
    if (user?.is_trial_used) {
      throw new Error("Trial already used");
    }

    const bizcard = await prisma.bizcard.findFirst({
      where: { serial_id: bizcardSerialId, user_id: userIdBigInt, deactivated_flag: false },
    });
    if (!bizcard) {
      throw new Error("Bizcard not found");
    }

    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 30);

    let trialPlan = await prisma.subscriptionPlan.findUnique({
      where: { tier_code: "free_trial" },
    });
    if (!trialPlan) {
      trialPlan = await prisma.subscriptionPlan.create({
        data: {
          name: "Free Trial",
          tier_code: "free_trial",
          price_monthly: new Prisma.Decimal(0),
          price_yearly: new Prisma.Decimal(0),
          max_virtual_cards: 1,
          max_physical_cards: 0,
          max_themes: 5,
          max_associates: 15,
          can_create_company: false,
          can_upload_gallery: false,
          can_manage_inquiries: false,
          can_real_time_analytics: false,
          can_affiliate: true,
          can_dashboard: true,
          trial_days: 30,
          is_trial: true,
          features: JSON.stringify([
            "Create 1 virtual card",
            "Affiliate access",
            "Basic dashboard",
            "5 free themes",
            "15 associates limit",
          ]),
        },
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { user_id: userIdBigInt },
        data: {
          is_trial_used: true,
          trial_start: new Date(),
          trial_end: trialEnd,
        },
      });

      const sub = await tx.bizcardSubscription.upsert({
        where: { bizcard_id: bizcard.bizcard_id },
        create: {
          bizcard_id: bizcard.bizcard_id,
          plan_id: trialPlan.id,
          status: "active",
          billing_cycle: "monthly",
          started_at: new Date(),
          expires_at: trialEnd,
          auto_renew: false,
        },
        update: {
          plan_id: trialPlan.id,
          status: "active",
          expires_at: trialEnd,
          auto_renew: false,
        },
      });

      await tx.bizcard.update({
        where: { bizcard_id: bizcard.bizcard_id },
        data: {
          subscription_tier: "free_trial",
          subscription_started_at: new Date(),
          subscription_expires_at: trialEnd,
          subscription_status: "active",
        },
      });

      await tx.subscriptionUpgradeLog.create({
        data: {
          bizcard_id: bizcard.bizcard_id,
          from_plan_id: undefined,
          to_plan_id: trialPlan.id,
          upgrade_type: "initial_trial",
          billing_cycle: "monthly",
          effective_date: new Date(),
          expiry_date: trialEnd,
        },
      });
    });

    await updateUserSubscriptionFlags(userIdBigInt);
  }

  async isSubscriptionExpired(userId: string | bigint): Promise<boolean> {
    const userIdBigInt = typeof userId === "string" ? BigInt(userId) : userId;
    if (await this.isDevUser(userIdBigInt)) return false;

    const sub = await this.getActiveSubscription(userIdBigInt);
    if (!sub) return true;
    if (sub.status === "expired") return true;
    if (!sub.expires_at) return false;

    const graceDays = SubscriptionService.DEFAULT_GRACE_DAYS;
    const expiryWithGrace = new Date(sub.expires_at);
    expiryWithGrace.setDate(expiryWithGrace.getDate() + graceDays);
    return new Date() > expiryWithGrace;
  }

  async expireDueSubscriptions(graceDays?: number): Promise<{ processed: number; expired: number }> {
    const gd = typeof graceDays === 'number' ? graceDays : SubscriptionService.DEFAULT_GRACE_DAYS;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - gd);

    const batchSize = 200;
    let cursor: bigint | null = null;
    let processed = 0;
    let expired = 0;

    while (true) {
      // Explicitly type the result
      const subs: ExpiringSubscription[] = await prisma.bizcardSubscription.findMany({
        where: {
          status: 'active',
          expires_at: { lt: cutoff },
          bizcard: { user: { role: { notIn: ['dev', 'super_admin'] } } },
        },
        orderBy: { id: 'asc' },
        take: batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: { plan: true, bizcard: true },
      });

      if (!subs.length) break;

      for (const s of subs) {
        try {
          await prisma.$transaction(async (tx) => {
            await tx.bizcardSubscription.update({
              where: { id: s.id },
              data: { status: 'expired', updated_at: new Date() },
            });
            await tx.bizcard.update({
              where: { bizcard_id: s.bizcard_id },
              data: { subscription_status: 'expired' },
            });
            await tx.subscriptionUpgradeLog.create({
              data: {
                bizcard_id: s.bizcard_id,
                from_plan_id: s.plan_id,
                to_plan_id: s.plan_id,
                upgrade_type: 'automatic_expiry',
                billing_cycle: s.billing_cycle ?? undefined,
                effective_date: new Date(),
                expiry_date: s.expires_at ?? undefined,
              },
            });
          });
          expired++;
        } catch (err) {
          console.error('[Expire Due] Error expiring subscription', s.id, err);
        }
        processed++;
        cursor = s.id;
      }

      if (subs.length < batchSize) break;
    }

    return { processed, expired };
  }

  async expireSubscription(userId: string | bigint): Promise<void> {
    const userIdBigInt = typeof userId === "string" ? BigInt(userId) : userId;
    if (await this.isDevUser(userIdBigInt)) return;

    const subs = await this.getActiveSubscriptions(userIdBigInt);
    for (const sub of subs) {
      await prisma.$transaction(async (tx) => {
        await tx.bizcardSubscription.update({
          where: { id: sub.id },
          data: { status: 'expired' },
        });
        await tx.bizcard.update({
          where: { bizcard_id: sub.bizcard_id },
          data: { subscription_status: 'expired' },
        });
        await tx.subscriptionUpgradeLog.create({
          data: {
            bizcard_id: sub.bizcard_id,
            from_plan_id: sub.plan_id,
            to_plan_id: sub.plan_id,
            upgrade_type: "automatic_expiry",
            billing_cycle: sub.billing_cycle ?? undefined,
            effective_date: new Date(),
            expiry_date: sub.expires_at ?? undefined,
          },
        });
      });
    }
    await updateUserSubscriptionFlags(userIdBigInt);
  }

  async getTierFeatures(userId: string | bigint): Promise<TierFeatures> {
    const userIdBigInt = typeof userId === "string" ? BigInt(userId) : userId;
    if (await this.isDevUser(userIdBigInt)) return this.getDevFeatures();

    const isExpired = await this.isSubscriptionExpired(userIdBigInt);
    if (isExpired) return this.getExpiredFeatures();

    const sub = await this.getActiveSubscription(userIdBigInt);
    if (!sub) return this.getDefaultFeatures();

    const plan = sub.plan;
    const features = this.planToFeatures(plan);

    const user = await prisma.user.findUnique({
      where: { user_id: userIdBigInt },
      select: { can_create_company: true },
    });
    if (user?.can_create_company) {
      features.canCreateCompany = true;
    }

    return features;
  }

  async getSubscriptionStatus(userId: string | bigint): Promise<SubscriptionStatus> {
    const userIdBigInt = typeof userId === "string" ? BigInt(userId) : userId;
    const accessService = new SubscriptionAccessService("subscription-status");
    const accessStatus = await accessService.getUserAccessStatus(userIdBigInt);
    const sub = await this.getActiveSubscription(userIdBigInt);
    const expirationFields = this.buildExpirationFields(
      accessStatus.reason,
      accessStatus.expirationKind,
    );

    if (await this.isPrivilegedPremiumUser(userIdBigInt)) {
      const user = await prisma.user.findUnique({
        where: { user_id: userIdBigInt },
        select: { role: true },
      });
      const role = String(user?.role ?? "")
        .trim()
        .toLowerCase();
      return {
        tier: role === "super_admin" ? "premium" : (sub?.plan?.tier_code ?? "dev"),
        status: "active",
        expiresAt: null,
        daysRemaining: 9999,
        isExpired: false,
        isTrial: false,
        features: this.getDevFeatures(),
        ...expirationFields,
      };
    }

    if (accessStatus.reason === "free_trial") {
      const premiumBoosted = Boolean(accessStatus.premiumBoostActive);
      const features = premiumBoosted
        ? await this.getTierFeaturesByCode("premium")
        : sub?.plan
          ? this.planToFeatures(sub.plan)
          : await this.getTrialPlanFeatures();

      return {
        tier: premiumBoosted
          ? "premium"
          : (sub?.plan?.tier_code ?? "free_trial"),
        status: "active",
        expiresAt: accessStatus.expiresAt ?? null,
        daysRemaining: accessStatus.daysRemaining ?? 0,
        isExpired: false,
        isTrial: true,
        features,
        ...expirationFields,
      };
    }

    if (accessStatus.reason === "active_subscription") {
      const expiresAt = accessStatus.expiresAt ?? sub?.expires_at ?? null;
      const daysRemaining = expiresAt
        ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : 0;
      const premiumBoosted = Boolean(accessStatus.premiumBoostActive);
      const marketplaceTier =
        sub?.plan && !sub.plan.is_trial ? sub.plan.tier_code : null;
      const resolvedTier = premiumBoosted
        ? "premium"
        : (accessStatus.highestTier ?? marketplaceTier ?? "unknown");

      return {
        tier: resolvedTier,
        status: "active",
        expiresAt,
        daysRemaining,
        isExpired: false,
        isTrial: false,
        features: premiumBoosted
          ? await this.getTierFeaturesByCode("premium")
          : accessStatus.highestTier
            ? await this.getTierFeaturesByCode(accessStatus.highestTier)
            : await this.getTierFeatures(userIdBigInt),
        ...expirationFields,
      };
    }

    if (accessStatus.reason === "trial_expired") {
      return {
        tier: "free_trial",
        status: "expired",
        expiresAt: accessStatus.expiresAt ?? null,
        daysRemaining: 0,
        isExpired: true,
        isTrial: true,
        features: this.getExpiredFeatures(),
        ...expirationFields,
      };
    }

    if (accessStatus.reason === "subscription_expired") {
      const tier =
        accessStatus.highestTier ??
        sub?.plan?.tier_code ??
        "none";

      return {
        tier,
        status: "expired",
        expiresAt: accessStatus.expiresAt ?? sub?.expires_at ?? null,
        daysRemaining: 0,
        isExpired: true,
        isTrial: false,
        features: this.getExpiredFeatures(),
        ...expirationFields,
      };
    }

    return {
      tier: "none",
      status: "expired",
      expiresAt: null,
      daysRemaining: 0,
      isExpired: true,
      isTrial: false,
      features: this.getExpiredFeatures(),
      ...expirationFields,
    };
  }

  async canCreateVirtualCard(userId: string | bigint): Promise<CardLimitCheck> {
    const userIdBigInt = typeof userId === "string" ? BigInt(userId) : userId;
    if (await this.isDevUser(userIdBigInt)) {
      const count = await prisma.bizcard.count({
        where: { user_id: userIdBigInt, bizcard_type: "virtual", deactivated_flag: false },
      });
      return { allowed: true, current: count, max: -1 };
    }

    const features = await this.getTierFeatures(userIdBigInt);
    const count = await prisma.bizcard.count({
      where: { user_id: userIdBigInt, bizcard_type: "virtual", deactivated_flag: false },
    });
    const max = features.maxVirtualCards === null ? Infinity : features.maxVirtualCards;
    return {
      allowed: count < max,
      current: count,
      max: max === Infinity ? -1 : max,
    };
  }

  async canCreatePhysicalCard(userId: string | bigint): Promise<CardLimitCheck> {
    const userIdBigInt = typeof userId === "string" ? BigInt(userId) : userId;
    if (await this.isDevUser(userIdBigInt)) {
      const count = await prisma.bizcard.count({
        where: { user_id: userIdBigInt, bizcard_type: "physical", deactivated_flag: false },
      });
      return { allowed: true, current: count, max: -1 };
    }

    const features = await this.getTierFeatures(userIdBigInt);
    const count = await prisma.bizcard.count({
      where: { user_id: userIdBigInt, bizcard_type: "physical", deactivated_flag: false },
    });
    const max = features.maxPhysicalCards === null ? Infinity : features.maxPhysicalCards;
    return {
      allowed: count < max,
      current: count,
      max: max === Infinity ? -1 : max,
    };
  }

  async isPortfolioVisible(userId: string | bigint): Promise<boolean> {
    const userIdBigInt = typeof userId === "string" ? BigInt(userId) : userId;
    if (await this.isDevUser(userIdBigInt)) return true;
    if (await this.isSubscriptionExpired(userIdBigInt)) return false;
    const sub = await this.getActiveSubscription(userIdBigInt);
    return sub?.status === "active";
  }

  async checkFeatureAccess(userId: string | bigint, feature: keyof TierFeatures): Promise<boolean> {
    const userIdBigInt = typeof userId === "string" ? BigInt(userId) : userId;
    if (await this.isDevUser(userIdBigInt)) return true;
    if (await this.isSubscriptionExpired(userIdBigInt)) return false;
    const features = await this.getTierFeatures(userIdBigInt);
    return Boolean(features[feature]);
  }

  async upgradeSubscription(
    userId: string | bigint,
    newTierCode: string,
    billingCycle: "monthly" | "yearly",
    bizcardSerialId: string
  ): Promise<void> {
    const userIdBigInt = typeof userId === "string" ? BigInt(userId) : userId;

    const bizcard = await prisma.bizcard.findFirst({
      where: { serial_id: bizcardSerialId, user_id: userIdBigInt, deactivated_flag: false },
    });
    if (!bizcard) throw new Error("Bizcard not found");

    const newPlan = await prisma.subscriptionPlan.findUnique({
      where: { tier_code: newTierCode },
    });
    if (!newPlan) throw new Error(`Invalid tier: ${newTierCode}`);

    const expiryDate = new Date();
    if (billingCycle === "monthly") expiryDate.setMonth(expiryDate.getMonth() + 1);
    else expiryDate.setFullYear(expiryDate.getFullYear() + 1);

    await prisma.$transaction(async (tx) => {
      const previous = await tx.bizcardSubscription.findUnique({
        where: { bizcard_id: bizcard.bizcard_id },
      });

      await tx.bizcardSubscription.upsert({
        where: { bizcard_id: bizcard.bizcard_id },
        create: {
          bizcard_id: bizcard.bizcard_id,
          plan_id: newPlan.id,
          status: "active",
          billing_cycle: billingCycle,
          started_at: new Date(),
          expires_at: expiryDate,
          auto_renew: true,
        },
        update: {
          plan_id: newPlan.id,
          status: "active",
          billing_cycle: billingCycle,
          expires_at: expiryDate,
          auto_renew: true,
        },
      });

      await tx.bizcard.update({
        where: { bizcard_id: bizcard.bizcard_id },
        data: {
          subscription_tier: newPlan.tier_code,
          subscription_started_at: new Date(),
          subscription_expires_at: expiryDate,
          subscription_status: "active",
        },
      });

      await tx.subscriptionUpgradeLog.create({
        data: {
          bizcard_id: bizcard.bizcard_id,
          from_plan_id: previous?.plan_id ?? undefined,
          to_plan_id: newPlan.id,
          upgrade_type: "upgrade",
          billing_cycle: billingCycle,
          effective_date: new Date(),
          expiry_date: expiryDate,
        },
      });
    });

    await updateUserSubscriptionFlags(userIdBigInt);

    try {
      const { archiveSubscriptionExpiryWarnings } = await import(
        "@/lib/services/subscription-expiry-reminder.service"
      );
      await archiveSubscriptionExpiryWarnings(userIdBigInt);
    } catch (error) {
      console.error(
        `[SUBSCRIPTION_SERVICE] Failed to archive expiry warnings after upgrade for user ${userIdBigInt.toString()}:`,
        error,
      );
    }
  }

  async getAvailablePlans(): Promise<
    Array<{
      tier: string;
      name: string;
      priceMonthly: number;
      priceYearly: number;
      features: string[];
    }>
  > {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { is_active: true, is_trial: false },
      orderBy: { price_monthly: "asc" },
    });
    return plans.map((plan) => ({
      tier: plan.tier_code,
      name: plan.name,
      priceMonthly: plan.price_monthly ? Number(plan.price_monthly) : 0,
      priceYearly: plan.price_yearly ? Number(plan.price_yearly) : 0,
      features: plan.features ? JSON.parse(plan.features) : [],
    }));
  }
}

export const subscriptionService = new SubscriptionService();