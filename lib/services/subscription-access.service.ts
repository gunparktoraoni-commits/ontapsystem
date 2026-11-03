import { addDays } from "date-fns";
import { prisma } from "@/server/lib/prisma";
import { ensureSuperadminBizcardsPremium } from "@/lib/services/superadmin-premium.service";
import { isSuperAdminRole } from "@/lib/auth/privileged-premium";
import {
  ensurePremiumBoostFreshness,
  getPremiumBoostSnapshot,
} from "@/lib/services/premium-experience.service";

export type AccessReason =
  | "free_trial"
  | "active_subscription"
  | "trial_expired"
  | "subscription_expired"
  | "none";

export type ExpirationKind = "free_trial" | "paid_subscription" | null;

export type SubscriptionTier = "basic" | "standard" | "premium";

export interface AccessStatus {
  hasAccess: boolean;
  reason: AccessReason;
  expiresAt?: Date | null;
  daysRemaining?: number;
  highestTier?: SubscriptionTier | null;
  activeBizcardId?: bigint | null;
  activeBizcardSerialId?: string | null;
  expirationKind?: ExpirationKind;
  /** Temporary premium overlay from exclusive 3-day offer or trial-upgrade promo */
  premiumBoostActive?: boolean;
  premiumBoostUntil?: Date | null;
  premiumBoostSource?: string | null;
}

export interface FreeTrialStatus {
  active: boolean;
  expired?: boolean;
  expiresAt?: Date | null;
  daysRemaining?: number;
}

export interface BizcardSubscriptionStatus {
  active: boolean;
  expired?: boolean;
  expiresAt?: Date | null;
  daysRemaining?: number;
  highestTier?: SubscriptionTier | null;
  activeBizcardId?: bigint | null;
  activeBizcardSerialId?: string | null;
}

export interface ExpirationSnapshot {
  kind: ExpirationKind;
  expired: boolean;
  expires_at: Date | null;
  days_remaining: number;
}

export interface PortfolioVisibilityResult {
  visible: boolean;
  message?: string;
  accessStatus: AccessStatus;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TIER_RANK: Record<SubscriptionTier, number> = {
  basic: 1,
  standard: 2,
  premium: 3,
};

const PAID_SUBSCRIPTION_REDIRECT = "/user/emarket?tab=subscription&reason=expired";
const TRIAL_EXPIRED_REDIRECT = "/user/emarket?tab=subscription&reason=trial";
const NO_ACCESS_REDIRECT = "/user/emarket?tab=subscription&reason=no-access";

function toBigInt(userId: string | bigint): bigint {
  return typeof userId === "string" ? BigInt(userId) : userId;
}

function daysRemaining(expiresAt: Date): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / DAY_MS));
}

function normalizeTier(raw: string | null | undefined): SubscriptionTier | null {
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  if (lowered === "basic" || lowered === "standard" || lowered === "premium") {
    return lowered;
  }
  return null;
}

function isPaidTier(tier: string | null | undefined): boolean {
  if (!tier) return false;
  const lowered = tier.toLowerCase();
  return lowered !== "free_trial" && lowered !== "none" && lowered !== "";
}

function compareSubscriptions(
  left: { subscription_tier: string | null; subscription_expires_at: Date | null; bizcard_id: bigint },
  right: { subscription_tier: string | null; subscription_expires_at: Date | null; bizcard_id: bigint }
): number {
  const leftTier = normalizeTier(left.subscription_tier);
  const rightTier = normalizeTier(right.subscription_tier);
  const leftRank = leftTier ? TIER_RANK[leftTier] : 0;
  const rightRank = rightTier ? TIER_RANK[rightTier] : 0;

  if (leftRank !== rightRank) return rightRank - leftRank;

  const leftExpiry = left.subscription_expires_at?.getTime() ?? 0;
  const rightExpiry = right.subscription_expires_at?.getTime() ?? 0;
  if (leftExpiry !== rightExpiry) return rightExpiry - leftExpiry;

  if (left.bizcard_id === right.bizcard_id) return 0;
  return right.bizcard_id > left.bizcard_id ? 1 : -1;
}

export function buildAccessRedirectUrl(reason: AccessReason): string {
  if (reason === "trial_expired") return TRIAL_EXPIRED_REDIRECT;
  if (reason === "subscription_expired") return PAID_SUBSCRIPTION_REDIRECT;
  if (reason === "none") return NO_ACCESS_REDIRECT;
  return NO_ACCESS_REDIRECT;
}

export function buildExpirationSnapshot(
  accessStatus: AccessStatus,
  freeTrial: FreeTrialStatus,
  bizcardSubscription: BizcardSubscriptionStatus,
): ExpirationSnapshot {
  if (accessStatus.reason === "free_trial") {
    return {
      kind: "free_trial",
      expired: false,
      expires_at: freeTrial.expiresAt ?? null,
      days_remaining: freeTrial.daysRemaining ?? 0,
    };
  }

  if (accessStatus.reason === "active_subscription") {
    return {
      kind: "paid_subscription",
      expired: false,
      expires_at: bizcardSubscription.expiresAt ?? accessStatus.expiresAt ?? null,
      days_remaining: bizcardSubscription.daysRemaining ?? accessStatus.daysRemaining ?? 0,
    };
  }

  if (accessStatus.reason === "trial_expired") {
    return {
      kind: "free_trial",
      expired: true,
      expires_at: accessStatus.expiresAt ?? freeTrial.expiresAt ?? null,
      days_remaining: 0,
    };
  }

  if (accessStatus.reason === "subscription_expired") {
    return {
      kind: "paid_subscription",
      expired: true,
      expires_at: accessStatus.expiresAt ?? bizcardSubscription.expiresAt ?? null,
      days_remaining: 0,
    };
  }

  return {
    kind: null,
    expired: false,
    expires_at: null,
    days_remaining: 0,
  };
}

export class SubscriptionAccessService {
  constructor(private readonly requestId: string) {}

  async initializeFreeTrial(userId: string | bigint): Promise<void> {
    const userKey = toBigInt(userId);
    const current = await prisma.user.findUnique({
      where: { user_id: userKey },
      select: { is_trial_used: true },
    });

    if (!current || current.is_trial_used) return;

    const startedAt = new Date();
    const expiresAt = addDays(startedAt, 3);

    await prisma.user.update({
      where: { user_id: userKey },
      data: {
        is_trial_used: true,
        trial_start: startedAt,
        trial_end: expiresAt,
      },
    });
  }

  async hasActiveFreeTrial(userId: string | bigint): Promise<FreeTrialStatus> {
    const user = await prisma.user.findUnique({
      where: { user_id: toBigInt(userId) },
      select: { is_trial_used: true, trial_end: true },
    });

    if (!user || !user.is_trial_used || !user.trial_end) {
      return { active: false, expired: false, expiresAt: null };
    }

    if (user.trial_end <= new Date()) {
      return { active: false, expired: true, expiresAt: user.trial_end, daysRemaining: 0 };
    }

    return {
      active: true,
      expired: false,
      expiresAt: user.trial_end,
      daysRemaining: daysRemaining(user.trial_end),
    };
  }

  async hasActiveBizcardSubscription(userId: string | bigint): Promise<BizcardSubscriptionStatus> {
    const activeBizcards = await prisma.bizcard.findMany({
      where: {
        user_id: toBigInt(userId),
        subscription_status: "active",
        subscription_expires_at: { gt: new Date() },
        deactivated_flag: false,
        deleted_at: null,
      },
      select: {
        bizcard_id: true,
        serial_id: true,
        subscription_tier: true,
        subscription_expires_at: true,
      },
    });

    if (!activeBizcards.length) {
      const expiredPaid = await this.hasExpiredPaidSubscription(userId);
      if (expiredPaid.expired) {
        return {
          active: false,
          expired: true,
          expiresAt: expiredPaid.expiresAt ?? null,
          daysRemaining: 0,
          highestTier: expiredPaid.highestTier ?? null,
        };
      }
      return { active: false, expired: false };
    }

    const highest = [...activeBizcards].sort(compareSubscriptions)[0];
    const expiresAt = highest.subscription_expires_at;
    const highestTier = normalizeTier(highest.subscription_tier);

    return {
      active: true,
      expired: false,
      expiresAt,
      daysRemaining: expiresAt ? daysRemaining(expiresAt) : undefined,
      highestTier,
      activeBizcardId: highest.bizcard_id,
      activeBizcardSerialId: highest.serial_id,
    };
  }

  private async hasExpiredPaidSubscription(userId: string | bigint): Promise<{
    expired: boolean;
    expiresAt?: Date | null;
    highestTier?: SubscriptionTier | null;
  }> {
    const userKey = toBigInt(userId);

    const [expiredBizcards, expiredSubs] = await Promise.all([
      prisma.bizcard.findMany({
        where: {
          user_id: userKey,
          serial_id: { not: null }, // [CRITICAL] Only check expired subscriptions for bizcards WITH serial_id
          subscription_status: "expired",
          deactivated_flag: false,
        },
        select: {
          subscription_tier: true,
          subscription_expires_at: true,
        },
      }),
      prisma.bizcardSubscription.findMany({
        where: {
          status: "expired",
          bizcard: { user_id: userKey, deactivated_flag: false },
          plan: { is_trial: false },
        },
        select: {
          expires_at: true,
          plan: { select: { tier_code: true } },
        },
        orderBy: { expires_at: "desc" },
        take: 1,
      }),
    ]);

    const paidExpiredBizcards = expiredBizcards.filter((b) => isPaidTier(b.subscription_tier));
    if (paidExpiredBizcards.length > 0) {
      const latest = paidExpiredBizcards.sort(
        (a, b) => (b.subscription_expires_at?.getTime() ?? 0) - (a.subscription_expires_at?.getTime() ?? 0),
      )[0];
      return {
        expired: true,
        expiresAt: latest.subscription_expires_at,
        highestTier: normalizeTier(latest.subscription_tier),
      };
    }

    if (expiredSubs.length > 0) {
      const latest = expiredSubs[0];
      return {
        expired: true,
        expiresAt: latest.expires_at,
        highestTier: normalizeTier(latest.plan?.tier_code ?? null),
      };
    }

    return { expired: false };
  }

  async getUserAccessStatus(userId: string | bigint): Promise<AccessStatus> {
    await ensurePremiumBoostFreshness(userId).catch((err) => {
      console.error("[SubscriptionAccess] Failed to refresh premium boost:", err);
    });

    const [freeTrial, bizcardSubscription] = await Promise.all([
      this.hasActiveFreeTrial(userId),
      this.hasActiveBizcardSubscription(userId),
    ]);

    const userRecord = await prisma.user.findUnique({
      where: { user_id: toBigInt(userId) },
      select: {
        role: true,
        is_trial_used: true,
        trial_end: true,
        premium_feature_boost_until: true,
        premium_feature_boost_source: true,
      },
    });

    const boost = getPremiumBoostSnapshot(userRecord ?? {});
    const boostFields = {
      premiumBoostActive: boost.active,
      premiumBoostUntil: boost.active ? boost.until : null,
      premiumBoostSource: boost.active ? boost.source : null,
    };
    const boostedTier = (base: SubscriptionTier | null | undefined): SubscriptionTier | null => {
      if (boost.active) return "premium";
      return base ?? null;
    };

    if (userRecord?.role === "dev" || userRecord?.role === "super_admin") {
      if (isSuperAdminRole(userRecord.role)) {
        // Keep DB tier in sync so UI / public portfolio see permanent premium.
        await ensureSuperadminBizcardsPremium(userId).catch((err) => {
          console.error("[SubscriptionAccess] Failed to ensure superadmin premium:", err);
        });
      }
      return {
        hasAccess: true,
        reason: "active_subscription",
        expiresAt: null,
        daysRemaining: 9999,
        highestTier: "premium",
        activeBizcardId: bizcardSubscription.activeBizcardId ?? null,
        activeBizcardSerialId: bizcardSubscription.activeBizcardSerialId ?? null,
        expirationKind: "paid_subscription",
        ...boostFields,
      };
    }

    // Paid (or Superadmin-assigned) tiers take precedence over an in-progress free trial.
    if (bizcardSubscription.active && bizcardSubscription.highestTier) {
      return {
        hasAccess: true,
        reason: "active_subscription",
        expiresAt: bizcardSubscription.expiresAt,
        daysRemaining: bizcardSubscription.daysRemaining,
        highestTier: boostedTier(bizcardSubscription.highestTier),
        activeBizcardId: bizcardSubscription.activeBizcardId ?? null,
        activeBizcardSerialId: bizcardSubscription.activeBizcardSerialId ?? null,
        expirationKind: "paid_subscription",
        ...boostFields,
      };
    }

    if (freeTrial.active) {
      return {
        hasAccess: true,
        reason: "free_trial",
        expiresAt: freeTrial.expiresAt,
        daysRemaining: freeTrial.daysRemaining,
        highestTier: boostedTier(bizcardSubscription.highestTier),
        activeBizcardId: bizcardSubscription.activeBizcardId ?? null,
        activeBizcardSerialId: bizcardSubscription.activeBizcardSerialId ?? null,
        expirationKind: "free_trial",
        ...boostFields,
      };
    }

    if (
      userRecord?.is_trial_used &&
      userRecord.trial_end &&
      userRecord.trial_end <= new Date()
    ) {
      return {
        hasAccess: false,
        reason: "trial_expired",
        expiresAt: userRecord.trial_end,
        daysRemaining: 0,
        expirationKind: "free_trial",
        ...boostFields,
      };
    }

    const paidExpired = await this.hasExpiredPaidSubscription(userId);
    if (paidExpired.expired) {
      return {
        hasAccess: false,
        reason: "subscription_expired",
        expiresAt: paidExpired.expiresAt ?? null,
        daysRemaining: 0,
        highestTier: paidExpired.highestTier ?? null,
        expirationKind: "paid_subscription",
        ...boostFields,
      };
    }

    return { hasAccess: false, reason: "none", expirationKind: null, ...boostFields };
  }

  async ensureActiveAccess(userId: string | bigint): Promise<{ allowed: boolean; redirectUrl?: string; accessStatus: AccessStatus }> {
    const accessStatus = await this.getUserAccessStatus(userId);

    if (!accessStatus.hasAccess) {
      return {
        allowed: false,
        redirectUrl: buildAccessRedirectUrl(accessStatus.reason),
        accessStatus,
      };
    }

    return { allowed: true, accessStatus };
  }

  async isPortfolioVisible(bizcardId: string | bigint): Promise<PortfolioVisibilityResult> {
    const bizcard = await prisma.bizcard.findUnique({
      where: { bizcard_id: toBigInt(bizcardId) },
      select: {
        bizcard_id: true,
        subscription_status: true,
        subscription_expires_at: true,
        subscription_tier: true,
        user: {
          select: {
            user_id: true,
            trial_end: true,
            is_trial_used: true,
          },
        },
      },
    });

    if (!bizcard || !bizcard.user) {
      return {
        visible: false,
        message: "Bizcard not found.",
        accessStatus: { hasAccess: false, reason: "none" },
      };
    }

    const accessStatus = await this.getUserAccessStatus(bizcard.user.user_id);
    if (accessStatus.hasAccess) {
      return { visible: true, accessStatus };
    }

    // Virtual cards awaiting first subscription — allow public portfolio when user never had paid/trial access
    if (
      accessStatus.reason === "none" &&
      (bizcard.subscription_status === "pending_activation" || bizcard.subscription_status === null)
    ) {
      return { visible: true, accessStatus };
    }

    if (accessStatus.reason === "trial_expired") {
      return {
        visible: false,
        message: "This profile is currently unavailable because the free trial has ended. Please visit /products to continue.",
        accessStatus,
      };
    }

    if (accessStatus.reason === "subscription_expired") {
      return {
        visible: false,
        message: "This profile is currently unavailable because the subscription has expired. Please visit /products to continue.",
        accessStatus,
      };
    }

    return {
      visible: false,
      message: "This profile is currently unavailable. Please visit /products to continue.",
      accessStatus,
    };
  }

  async getFreeTrialsExpiringSoon(): Promise<Array<{ user_id: bigint; email: string; first_name: string | null; last_name: string | null; trial_end: Date | null }>> {
    const now = new Date();
    const tomorrow = addDays(now, 1);

    return prisma.user.findMany({
      where: {
        is_trial_used: true,
        trial_end: {
          gt: now,
          lte: tomorrow,
        },
      },
      select: {
        user_id: true,
        email: true,
        first_name: true,
        last_name: true,
        trial_end: true,
      },
    });
  }

  async getSubscriptionsExpiringSoon(): Promise<Array<{
    bizcard_id: bigint;
    serial_id: string | null;
    subscription_tier: string | null;
    subscription_expires_at: Date | null;
    user: { user_id: bigint; email: string; first_name: string | null; last_name: string | null } | null;
  }>> {
    const now = new Date();
    const thirtyDaysLater = addDays(now, 30);

    return prisma.bizcard.findMany({
      where: {
        subscription_status: "active",
        subscription_expires_at: {
          gt: now,
          lte: thirtyDaysLater,
        },
        deactivated_flag: false,
      },
      select: {
        bizcard_id: true,
        serial_id: true,
        subscription_tier: true,
        subscription_expires_at: true,
        user: {
          select: {
            user_id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
      },
      orderBy: [{ subscription_expires_at: "asc" }, { bizcard_id: "asc" }],
    });
  }
}
