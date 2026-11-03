import { addDays } from "date-fns";
import { prisma } from "@/server/lib/prisma";

export const EXCLUSIVE_PREMIUM_DAYS = 3;
export const TRIAL_UPGRADE_PREMIUM_DAYS = 30;

export const EXCLUSIVE_OFFER_PENDING = "pending";
export const EXCLUSIVE_OFFER_ACCEPTED = "accepted";
export const EXCLUSIVE_OFFER_DECLINED = "declined";
export const EXCLUSIVE_OFFER_EXPIRED = "expired";

export const TRIAL_UPGRADE_EMAILED = "emailed";
export const TRIAL_UPGRADE_CLAIMED = "claimed";

export const BOOST_SOURCE_EXCLUSIVE_2W = "exclusive_2w"; // stored source id; duration is EXCLUSIVE_PREMIUM_DAYS
export const BOOST_SOURCE_TRIAL_UPGRADE_1M = "trial_upgrade_1m";

const PAID_TIERS = ["basic", "standard", "premium", "enterprise"] as const;

export type ExclusiveOfferDecision = "accept" | "decline";

export type PremiumBoostSnapshot = {
  active: boolean;
  until: Date | null;
  source: string | null;
  daysRemaining: number;
};

export type ExclusiveOfferEligibility = {
  eligible: boolean;
  reason:
    | "eligible"
    | "not_free_trial"
    | "has_paid_subscription"
    | "already_accepted"
    | "already_declined"
    | "offer_expired"
    | "boost_active"
    | "user_inactive";
  offerStatus: string | null;
  freeTrialActive: boolean;
  freeTrialEndsAt: Date | null;
  boost: PremiumBoostSnapshot;
};

function toBigInt(userId: string | bigint): bigint {
  return typeof userId === "string" ? BigInt(userId) : userId;
}

function daysRemaining(until: Date | null | undefined): number {
  if (!until) return 0;
  return Math.max(0, Math.ceil((until.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

function parseRestoreMap(raw: string | null | undefined): Record<string, string | null> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      out[key] = value == null ? null : String(value);
    }
    return out;
  } catch {
    return {};
  }
}

export function getPremiumBoostSnapshot(user: {
  premium_feature_boost_until?: Date | null;
  premium_feature_boost_source?: string | null;
}): PremiumBoostSnapshot {
  const until = user.premium_feature_boost_until ?? null;
  const active = Boolean(until && until.getTime() > Date.now());
  return {
    active,
    until: active ? until : until && until.getTime() <= Date.now() ? until : until,
    source: active ? user.premium_feature_boost_source ?? null : null,
    daysRemaining: active ? daysRemaining(until) : 0,
  };
}

async function userHasActivePaidBizcard(userId: bigint, now: Date = new Date()): Promise<boolean> {
  const hit = await prisma.bizcard.findFirst({
    where: {
      user_id: userId,
      serial_id: { not: null },
      subscription_status: "active",
      subscription_expires_at: { gt: now },
      deactivated_flag: false,
      subscription_tier: { in: [...PAID_TIERS] },
    },
    select: { bizcard_id: true },
  });
  return Boolean(hit);
}

/**
 * Exclusive 3-day premium modal: only active free-trial users without a paid plan.
 */
export async function getExclusivePremiumOfferEligibility(
  userId: string | bigint,
): Promise<ExclusiveOfferEligibility> {
  const userKey = toBigInt(userId);
  const now = new Date();

  const user = await prisma.user.findUnique({
    where: { user_id: userKey },
    select: {
      is_active: true,
      deactivated_flag: true,
      deleted_at: true,
      is_trial_used: true,
      trial_end: true,
      exclusive_premium_offer_status: true,
      premium_feature_boost_until: true,
      premium_feature_boost_source: true,
    },
  });

  const boost = getPremiumBoostSnapshot(user ?? {});

  if (!user || !user.is_active || user.deactivated_flag || user.deleted_at) {
    return {
      eligible: false,
      reason: "user_inactive",
      offerStatus: user?.exclusive_premium_offer_status ?? null,
      freeTrialActive: false,
      freeTrialEndsAt: null,
      boost,
    };
  }

  const freeTrialActive = Boolean(
    user.is_trial_used && user.trial_end && user.trial_end.getTime() > now.getTime(),
  );
  const status = user.exclusive_premium_offer_status?.toLowerCase() ?? null;

  if (status === EXCLUSIVE_OFFER_ACCEPTED) {
    return {
      eligible: false,
      reason: "already_accepted",
      offerStatus: status,
      freeTrialActive,
      freeTrialEndsAt: user.trial_end,
      boost,
    };
  }
  if (status === EXCLUSIVE_OFFER_DECLINED) {
    return {
      eligible: false,
      reason: "already_declined",
      offerStatus: status,
      freeTrialActive,
      freeTrialEndsAt: user.trial_end,
      boost,
    };
  }
  if (status === EXCLUSIVE_OFFER_EXPIRED) {
    return {
      eligible: false,
      reason: "offer_expired",
      offerStatus: status,
      freeTrialActive,
      freeTrialEndsAt: user.trial_end,
      boost,
    };
  }

  if (!freeTrialActive) {
    return {
      eligible: false,
      reason: "not_free_trial",
      offerStatus: status,
      freeTrialActive: false,
      freeTrialEndsAt: user.trial_end,
      boost,
    };
  }

  if (await userHasActivePaidBizcard(userKey, now)) {
    return {
      eligible: false,
      reason: "has_paid_subscription",
      offerStatus: status,
      freeTrialActive: true,
      freeTrialEndsAt: user.trial_end,
      boost,
    };
  }

  if (boost.active && boost.source === BOOST_SOURCE_EXCLUSIVE_2W) {
    return {
      eligible: false,
      reason: "boost_active",
      offerStatus: status,
      freeTrialActive: true,
      freeTrialEndsAt: user.trial_end,
      boost,
    };
  }

  return {
    eligible: true,
    reason: "eligible",
    offerStatus: status ?? EXCLUSIVE_OFFER_PENDING,
    freeTrialActive: true,
    freeTrialEndsAt: user.trial_end,
    boost,
  };
}

async function applyPremiumTierToUserBizcards(
  userId: bigint,
): Promise<Record<string, string | null>> {
  const cards = await prisma.bizcard.findMany({
    where: { user_id: userId, deactivated_flag: false },
    select: { bizcard_id: true, subscription_tier: true },
  });

  const restore: Record<string, string | null> = {};
  for (const card of cards) {
    restore[card.bizcard_id.toString()] = card.subscription_tier;
  }

  if (cards.length > 0) {
    await prisma.bizcard.updateMany({
      where: {
        user_id: userId,
        deactivated_flag: false,
        bizcard_id: { in: cards.map((c) => c.bizcard_id) },
      },
      data: { subscription_tier: "premium" },
    });
  }

  return restore;
}

async function restoreBizcardTiersFromMap(
  restoreMap: Record<string, string | null>,
): Promise<number> {
  let restored = 0;
  for (const [bizcardId, tier] of Object.entries(restoreMap)) {
    try {
      await prisma.bizcard.update({
        where: { bizcard_id: BigInt(bizcardId) },
        data: { subscription_tier: tier },
      });
      restored += 1;
    } catch (error) {
      console.warn("[premium-experience] failed to restore bizcard tier", bizcardId, error);
    }
  }
  return restored;
}

/**
 * Accept or decline the exclusive 3-day premium experience.
 */
export async function respondToExclusivePremiumOffer(
  userId: string | bigint,
  decision: ExclusiveOfferDecision,
): Promise<{
  success: boolean;
  status: string;
  boostUntil?: Date | null;
  message: string;
}> {
  const userKey = toBigInt(userId);
  const eligibility = await getExclusivePremiumOfferEligibility(userKey);

  if (decision === "decline") {
    if (!eligibility.eligible && eligibility.reason !== "eligible") {
      if (
        eligibility.reason === "already_declined" ||
        eligibility.reason === "already_accepted"
      ) {
        return {
          success: true,
          status: eligibility.offerStatus ?? eligibility.reason,
          message: "Offer response already recorded.",
        };
      }
      if (!eligibility.freeTrialActive) {
        return {
          success: false,
          status: eligibility.offerStatus ?? "ineligible",
          message: "Exclusive premium offer is only available during an active free trial.",
        };
      }
    }

    await prisma.user.update({
      where: { user_id: userKey },
      data: {
        exclusive_premium_offer_status: EXCLUSIVE_OFFER_DECLINED,
        exclusive_premium_offer_at: new Date(),
      },
    });

    return {
      success: true,
      status: EXCLUSIVE_OFFER_DECLINED,
      message: "Exclusive premium offer declined.",
    };
  }

  if (!eligibility.eligible) {
    return {
      success: false,
      status: eligibility.offerStatus ?? eligibility.reason,
      message:
        eligibility.reason === "has_paid_subscription"
          ? "Paid subscriptions are not eligible for the free-trial exclusive offer."
          : "You are not eligible for the exclusive premium experience.",
    };
  }

  const now = new Date();
  const boostUntil = addDays(now, EXCLUSIVE_PREMIUM_DAYS);
  const restoreMap = await applyPremiumTierToUserBizcards(userKey);

  await prisma.user.update({
    where: { user_id: userKey },
    data: {
      exclusive_premium_offer_status: EXCLUSIVE_OFFER_ACCEPTED,
      exclusive_premium_offer_at: now,
      exclusive_premium_accepted_at: now,
      premium_feature_boost_until: boostUntil,
      premium_feature_boost_source: BOOST_SOURCE_EXCLUSIVE_2W,
      premium_feature_boost_restore_json: JSON.stringify(restoreMap),
    },
  });

  return {
    success: true,
    status: EXCLUSIVE_OFFER_ACCEPTED,
    boostUntil,
    message: `Premium features unlocked for ${EXCLUSIVE_PREMIUM_DAYS} days.`,
  };
}

/**
 * Mark offer as shown (pending) the first time the modal is eligible.
 */
export async function markExclusiveOfferPresented(userId: string | bigint): Promise<void> {
  const userKey = toBigInt(userId);
  const user = await prisma.user.findUnique({
    where: { user_id: userKey },
    select: { exclusive_premium_offer_status: true },
  });
  if (user?.exclusive_premium_offer_status) return;

  await prisma.user.update({
    where: { user_id: userKey },
    data: {
      exclusive_premium_offer_status: EXCLUSIVE_OFFER_PENDING,
      exclusive_premium_offer_at: new Date(),
    },
  });
}

export async function isPremiumFeatureBoostActive(userId: string | bigint): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { user_id: toBigInt(userId) },
    select: {
      premium_feature_boost_until: true,
      premium_feature_boost_source: true,
    },
  });
  return getPremiumBoostSnapshot(user ?? {}).active;
}

/**
 * After basic/standard purchase: grant 1 month of premium if expired free-trial promo applies.
 */
export async function maybeApplyTrialUpgradePremiumBoost(params: {
  userId: string | bigint;
  purchasedTier: string;
  tx?: Parameters<typeof applyTrialUpgradeInTx>[0]["tx"];
}): Promise<{ applied: boolean; effectiveTier: string; boostUntil: Date | null }> {
  const purchasedTier = params.purchasedTier.trim().toLowerCase();
  if (purchasedTier !== "basic" && purchasedTier !== "standard") {
    return { applied: false, effectiveTier: purchasedTier, boostUntil: null };
  }

  if (params.tx) {
    return applyTrialUpgradeInTx({
      tx: params.tx,
      userId: toBigInt(params.userId),
      purchasedTier,
    });
  }

  return prisma.$transaction(async (tx) =>
    applyTrialUpgradeInTx({
      tx,
      userId: toBigInt(params.userId),
      purchasedTier,
    }),
  );
}

async function applyTrialUpgradeInTx(params: {
   
  tx: any;
  userId: bigint;
  purchasedTier: string;
}): Promise<{ applied: boolean; effectiveTier: string; boostUntil: Date | null }> {
  const { tx, userId, purchasedTier } = params;
  const now = new Date();

  const user = await tx.user.findUnique({
    where: { user_id: userId },
    select: {
      is_trial_used: true,
      trial_end: true,
      trial_upgrade_promo_status: true,
      premium_feature_boost_until: true,
      premium_feature_boost_source: true,
      premium_feature_boost_restore_json: true,
    },
  });

  if (!user?.is_trial_used || !user.trial_end || user.trial_end.getTime() > now.getTime()) {
    return { applied: false, effectiveTier: purchasedTier, boostUntil: null };
  }

  if (user.trial_upgrade_promo_status === TRIAL_UPGRADE_CLAIMED) {
    return { applied: false, effectiveTier: purchasedTier, boostUntil: null };
  }

  const boostUntil = addDays(now, TRIAL_UPGRADE_PREMIUM_DAYS);
  const cards = (await tx.bizcard.findMany({
    where: { user_id: userId, deactivated_flag: false },
    select: { bizcard_id: true, subscription_tier: true },
  })) as Array<{ bizcard_id: bigint; subscription_tier: string | null }>;

  const existingRestore = parseRestoreMap(user.premium_feature_boost_restore_json);
  const restore: Record<string, string | null> = { ...existingRestore };
  for (const card of cards) {
    const key = card.bizcard_id.toString();
    if (!(key in restore)) {
      restore[key] = purchasedTier;
    }
  }

  if (cards.length > 0) {
    await tx.bizcard.updateMany({
      where: {
        user_id: userId,
        deactivated_flag: false,
        bizcard_id: { in: cards.map((c: { bizcard_id: bigint }) => c.bizcard_id) },
      },
      data: { subscription_tier: "premium" },
    });
  }

  await tx.user.update({
    where: { user_id: userId },
    data: {
      trial_upgrade_promo_status: TRIAL_UPGRADE_CLAIMED,
      trial_upgrade_promo_claimed_at: now,
      premium_feature_boost_until: boostUntil,
      premium_feature_boost_source: BOOST_SOURCE_TRIAL_UPGRADE_1M,
      premium_feature_boost_restore_json: JSON.stringify(restore),
    },
  });

  return { applied: true, effectiveTier: "premium", boostUntil };
}

/**
 * Expire ended boosts and restore prior bizcard tiers.
 */
export async function expirePremiumFeatureBoosts(
  now: Date = new Date(),
  options: { limit?: number; dryRun?: boolean } = {},
): Promise<{ scanned: number; expired: number; restoredCards: number; dryRun: boolean }> {
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const dryRun = Boolean(options.dryRun);

  const users = await prisma.user.findMany({
    where: {
      premium_feature_boost_until: { lte: now },
      OR: [
        { premium_feature_boost_source: { not: null } },
        { premium_feature_boost_restore_json: { not: null } },
      ],
    },
    select: {
      user_id: true,
      exclusive_premium_offer_status: true,
      premium_feature_boost_source: true,
      premium_feature_boost_restore_json: true,
    },
    take: limit,
  });

  let expired = 0;
  let restoredCards = 0;

  for (const user of users) {
    if (dryRun) {
      expired += 1;
      continue;
    }

    const restoreMap = parseRestoreMap(user.premium_feature_boost_restore_json);
    restoredCards += await restoreBizcardTiersFromMap(restoreMap);

    await prisma.user.update({
      where: { user_id: user.user_id },
      data: {
        premium_feature_boost_until: null,
        premium_feature_boost_source: null,
        premium_feature_boost_restore_json: null,
        ...(user.exclusive_premium_offer_status === EXCLUSIVE_OFFER_ACCEPTED &&
        user.premium_feature_boost_source === BOOST_SOURCE_EXCLUSIVE_2W
          ? { exclusive_premium_offer_status: EXCLUSIVE_OFFER_EXPIRED }
          : {}),
      },
    });
    expired += 1;
  }

  return { scanned: users.length, expired, restoredCards, dryRun };
}

/**
 * Lazy-expire a single user's boost if the end date has passed.
 */
export async function ensurePremiumBoostFreshness(userId: string | bigint): Promise<void> {
  const userKey = toBigInt(userId);
  const user = await prisma.user.findUnique({
    where: { user_id: userKey },
    select: {
      premium_feature_boost_until: true,
      premium_feature_boost_source: true,
      premium_feature_boost_restore_json: true,
      exclusive_premium_offer_status: true,
    },
  });

  if (!user?.premium_feature_boost_until) return;
  if (user.premium_feature_boost_until.getTime() > Date.now()) return;

  const restoreMap = parseRestoreMap(user.premium_feature_boost_restore_json);
  await restoreBizcardTiersFromMap(restoreMap);

  await prisma.user.update({
    where: { user_id: userKey },
    data: {
      premium_feature_boost_until: null,
      premium_feature_boost_source: null,
      premium_feature_boost_restore_json: null,
      ...(user.exclusive_premium_offer_status === EXCLUSIVE_OFFER_ACCEPTED &&
      user.premium_feature_boost_source === BOOST_SOURCE_EXCLUSIVE_2W
        ? { exclusive_premium_offer_status: EXCLUSIVE_OFFER_EXPIRED }
        : {}),
    },
  });
}

export type PremiumTrialRecapEligibility = {
  eligible: boolean;
  reason:
    | "eligible"
    | "never_accepted"
    | "boost_active"
    | "trial_still_active"
    | "has_paid_subscription"
    | "already_dismissed"
    | "user_inactive";
};

export type PremiumTrialRecapSummary = {
  first_name: string;
  premium_period: {
    started_at: string;
    ended_at: string;
    days: number;
  };
  company: {
    name: string | null;
    role: string | null;
  };
  affiliate: {
    is_affiliate: boolean;
    total_earnings: number;
    successful_referrals: number;
  };
  associates: {
    total: number;
    recent: Array<{ name: string; connected_at: string }>;
  };
  engagement: {
    profile_views: number;
    contact_saves: number;
    inquiries: number;
    new_connections: number;
  };
  interactions: {
    inquiry_contacts: Array<{ name: string; created_at: string }>;
  };
  highlights: string[];
};

function premiumBoostEnded(
  user: {
    exclusive_premium_accepted_at: Date | null;
    exclusive_premium_offer_status: string | null;
    premium_feature_boost_until: Date | null;
    premium_feature_boost_source: string | null;
  },
  now: Date,
): boolean {
  if (!user.exclusive_premium_accepted_at) return false;
  if (user.exclusive_premium_offer_status === EXCLUSIVE_OFFER_EXPIRED) return true;
  if (
    user.premium_feature_boost_until &&
    user.premium_feature_boost_source === BOOST_SOURCE_EXCLUSIVE_2W &&
    user.premium_feature_boost_until.getTime() <= now.getTime()
  ) {
    return true;
  }
  const computedEnd = addDays(user.exclusive_premium_accepted_at, EXCLUSIVE_PREMIUM_DAYS);
  return computedEnd.getTime() <= now.getTime();
}

/**
 * Recap modal after the exclusive 3-day premium window ends.
 * Only for users whose free trial expired and who have no paid bizcard.
 */
export async function getPremiumTrialRecapEligibility(
  userId: string | bigint,
): Promise<PremiumTrialRecapEligibility> {
  const userKey = toBigInt(userId);
  const now = new Date();
  await ensurePremiumBoostFreshness(userKey);

  const user = await prisma.user.findUnique({
    where: { user_id: userKey },
    select: {
      is_active: true,
      deactivated_flag: true,
      deleted_at: true,
      is_trial_used: true,
      trial_end: true,
      exclusive_premium_accepted_at: true,
      exclusive_premium_offer_status: true,
      exclusive_premium_recap_dismissed_at: true,
      premium_feature_boost_until: true,
      premium_feature_boost_source: true,
    },
  });

  if (!user || !user.is_active || user.deactivated_flag || user.deleted_at) {
    return { eligible: false, reason: "user_inactive" };
  }
  if (!user.exclusive_premium_accepted_at) {
    return { eligible: false, reason: "never_accepted" };
  }
  if (user.exclusive_premium_recap_dismissed_at) {
    return { eligible: false, reason: "already_dismissed" };
  }
  if (await userHasActivePaidBizcard(userKey, now)) {
    return { eligible: false, reason: "has_paid_subscription" };
  }

  const trialExpired = Boolean(
    user.is_trial_used && user.trial_end && user.trial_end.getTime() <= now.getTime(),
  );
  if (!trialExpired) {
    return { eligible: false, reason: "trial_still_active" };
  }

  const boostActive =
    user.premium_feature_boost_until &&
    user.premium_feature_boost_source === BOOST_SOURCE_EXCLUSIVE_2W &&
    user.premium_feature_boost_until.getTime() > now.getTime();
  if (boostActive) {
    return { eligible: false, reason: "boost_active" };
  }

  if (!premiumBoostEnded(user, now)) {
    return { eligible: false, reason: "boost_active" };
  }

  return { eligible: true, reason: "eligible" };
}

export async function buildPremiumTrialRecapSummary(
  userId: string | bigint,
): Promise<PremiumTrialRecapSummary> {
  const userKey = toBigInt(userId);
  const user = await prisma.user.findUnique({
    where: { user_id: userKey },
    select: {
      first_name: true,
      is_affiliate: true,
      total_affiliate_earnings: true,
      total_successful_referrals: true,
      exclusive_premium_accepted_at: true,
      company_id: true,
      company: { select: { name: true } },
      companyEmployeeRecords: {
        where: { is_active: true },
        take: 1,
        select: {
          role: true,
          company: { select: { name: true } },
        },
      },
    },
  });

  const startedAt = user?.exclusive_premium_accepted_at ?? new Date();
  const endedAt = addDays(startedAt, EXCLUSIVE_PREMIUM_DAYS);

  const bizcards = await prisma.bizcard.findMany({
    where: { user_id: userKey, deactivated_flag: false },
    select: { bizcard_id: true },
  });
  const bizcardIds = bizcards.map((b) => b.bizcard_id);

  const { prismaAnalytics } = await import("@/server/lib/prisma-analytics");
  const { countAcceptedConnections } = await import("@/server/lib/connections");

  const [
    associatesTotal,
    connectionRows,
    profileViews,
    contactSaves,
    inquiries,
    newConnections,
    inquiryContacts,
  ] = await Promise.all([
    countAcceptedConnections(userKey),
    prisma.connection.findMany({
      where: {
        status: "accepted",
        OR: [{ requester_user_id: userKey }, { recipient_user_id: userKey }],
      },
      orderBy: { created_at: "desc" },
      take: 6,
      select: {
        created_at: true,
        requester_user_id: true,
        recipient_user_id: true,
        requester: { select: { first_name: true, last_name: true } },
        recipient: { select: { first_name: true, last_name: true } },
      },
    }),
    bizcardIds.length
      ? prismaAnalytics.portfolioView.count({
          where: {
            bizcard_id: { in: bizcardIds },
            created_at: { gte: startedAt, lte: endedAt },
          },
        })
      : Promise.resolve(0),
    bizcardIds.length
      ? prismaAnalytics.contactSave.count({
          where: {
            bizcard_id: { in: bizcardIds },
            created_at: { gte: startedAt, lte: endedAt },
          },
        })
      : Promise.resolve(0),
    prisma.inquiry.count({
      where: {
        user_id: userKey,
        created_at: { gte: startedAt, lte: endedAt },
      },
    }),
    prisma.connection.count({
      where: {
        status: "accepted",
        OR: [{ requester_user_id: userKey }, { recipient_user_id: userKey }],
        created_at: { gte: startedAt, lte: endedAt },
      },
    }),
    prisma.inquiry.findMany({
      where: {
        user_id: userKey,
        created_at: { gte: startedAt, lte: endedAt },
      },
      orderBy: { created_at: "desc" },
      take: 5,
      select: {
        visitor_name: true,
        created_at: true,
      },
    }),
  ]);

  const recentAssociates = connectionRows.map((row: (typeof connectionRows)[number]) => {
    const other =
      row.requester_user_id === userKey ? row.recipient : row.requester;
    const name = [other.first_name, other.last_name].filter(Boolean).join(" ").trim();
    return {
      name: name || "OnTap member",
      connected_at: row.created_at.toISOString(),
    };
  });

  const companyName =
    user?.company?.name ??
    user?.companyEmployeeRecords[0]?.company?.name ??
    null;
  const companyRole = user?.companyEmployeeRecords[0]?.role ?? null;

  const earnings = Number(user?.total_affiliate_earnings ?? 0);
  const referrals = Number(user?.total_successful_referrals ?? 0);

  const highlights: string[] = [];
  if (profileViews > 0) {
    highlights.push(`${profileViews} profile view${profileViews === 1 ? "" : "s"} during your Premium trial`);
  }
  if (associatesTotal > 0) {
    highlights.push(`${associatesTotal} associate${associatesTotal === 1 ? "" : "s"} in your network`);
  }
  if (referrals > 0) {
    highlights.push(`${referrals} successful referral${referrals === 1 ? "" : "s"}`);
  }
  if (inquiries > 0) {
    highlights.push(`${inquiries} inquiry message${inquiries === 1 ? "" : "s"} received`);
  }
  if (companyName) {
    highlights.push(`Connected with ${companyName}`);
  }
  if (highlights.length === 0) {
    highlights.push("You explored Premium tools — pick a plan to keep the momentum going.");
  }

  return {
    first_name: user?.first_name?.trim() || "there",
    premium_period: {
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      days: EXCLUSIVE_PREMIUM_DAYS,
    },
    company: {
      name: companyName,
      role: companyRole,
    },
    affiliate: {
      is_affiliate: Boolean(user?.is_affiliate),
      total_earnings: earnings,
      successful_referrals: referrals,
    },
    associates: {
      total: associatesTotal,
      recent: recentAssociates,
    },
    engagement: {
      profile_views: profileViews,
      contact_saves: contactSaves,
      inquiries,
      new_connections: newConnections,
    },
    interactions: {
      inquiry_contacts: inquiryContacts
        .filter((row: (typeof inquiryContacts)[number]) => row.visitor_name?.trim())
        .map((row: (typeof inquiryContacts)[number]) => ({
          name: row.visitor_name!.trim(),
          created_at: row.created_at.toISOString(),
        })),
    },
    highlights,
  };
}

export async function dismissPremiumTrialRecap(userId: string | bigint): Promise<void> {
  await prisma.user.update({
    where: { user_id: toBigInt(userId) },
    data: { exclusive_premium_recap_dismissed_at: new Date() },
  });
}
