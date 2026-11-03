import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import {
  getOrGenerateAffiliateCode,
  validateAffiliateCode,
} from "@/server/lib/affiliate";
import { syncMissionRewardsForUser, loadMissionsProgressForUser } from "@/server/lib/growth-rewards";

export const REFERRAL_STATUS_PENDING = "pending";
export const REFERRAL_STATUS_QUALIFIED = "qualified";
export const REFERRAL_STATUS_REVOKED = "revoked";

export type QualificationSource = "subscription" | "marketplace_purchase";

/** Fallback if Mission table is empty (should be seeded). */
export const MISSION_DEFINITIONS = [
  {
    key: "build_your_network",
    title: "Build Your Network",
    description: "Refer 3 qualified users",
    instruction:
      "1. Share your Ontap referral link.\n2. A new user joins through your referral.\n3. That user completes a qualifying Ontap purchase or subscription.\n4. The referral becomes qualified.\n5. Reach 3 qualified referrals to complete this mission.",
    target: 3,
    reward_label: "",
  },
  {
    key: "bring_a_friend",
    title: "Bring a Friend",
    description: "Refer 5 qualified users",
    instruction:
      "1. Share your Ontap referral link.\n2. A new user joins through your referral.\n3. That user completes a qualifying Ontap purchase or subscription.\n4. The referral becomes qualified.\n5. Reach 5 qualified referrals to complete this mission.",
    target: 5,
    reward_label: "",
  },
  {
    key: "grow_your_reach",
    title: "Grow Your Reach",
    description: "Refer 10 qualified users",
    instruction:
      "1. Share your Ontap referral link.\n2. A new user joins through your referral.\n3. That user completes a qualifying Ontap purchase or subscription.\n4. The referral becomes qualified.\n5. Reach 10 qualified referrals to complete this mission.",
    target: 10,
    reward_label: "",
  },
] as const;

export function buildGrowthInviteUrl(affiliateCode: string, appUrl: string) {
  const base = appUrl?.trim().replace(/\/$/, "") || "https://ontap.com";
  const normalizedCode = encodeURIComponent(affiliateCode.trim());
  return `${base}/user/signup?invite=${normalizedCode}`;
}

export async function resolveReferrerFromCode(code: string | null | undefined) {
  if (!code || !String(code).trim()) return null;
  return validateAffiliateCode(String(code));
}

export async function createPendingReferral(input: {
  referrerId: bigint | number;
  referredUserId: bigint | number;
}): Promise<{ created: boolean; reason?: string }> {
  const referrerId = BigInt(input.referrerId);
  const referredUserId = BigInt(input.referredUserId);

  if (referrerId === referredUserId) {
    return { created: false, reason: "self_referral" };
  }

  const existing = await prisma.referral.findFirst({
    where: { referred_user_id: referredUserId },
    select: { id: true },
  });
  if (existing) {
    return { created: false, reason: "already_referred" };
  }

  try {
    await prisma.referral.create({
      data: {
        affiliate_user_id: referrerId,
        referred_user_id: referredUserId,
        status: REFERRAL_STATUS_PENDING,
      },
    });
    return { created: true };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return { created: false, reason: "duplicate" };
    }
    throw err;
  }
}

export async function tryQualifyReferral(input: {
  referredUserId: bigint | number;
  source: QualificationSource;
}): Promise<{ qualified: boolean; reason?: string }> {
  const referredUserId = BigInt(input.referredUserId);
  const now = new Date();

  const pending = await prisma.referral.findFirst({
    where: {
      referred_user_id: referredUserId,
      status: REFERRAL_STATUS_PENDING,
    },
    select: { id: true, affiliate_user_id: true },
  });

  if (!pending) {
    const existing = await prisma.referral.findFirst({
      where: { referred_user_id: referredUserId },
      select: { status: true },
    });
    if (!existing) return { qualified: false, reason: "no_referral" };
    if (existing.status === REFERRAL_STATUS_QUALIFIED) {
      return { qualified: false, reason: "already_qualified" };
    }
    return { qualified: false, reason: "not_pending" };
  }

  const result = await prisma.referral.updateMany({
    where: {
      id: pending.id,
      status: REFERRAL_STATUS_PENDING,
    },
    data: {
      status: REFERRAL_STATUS_QUALIFIED,
      conversion_date: now,
      qualification_source: input.source,
      updated_at: now,
    },
  });

  if (result.count === 0) {
    return { qualified: false, reason: "already_qualified" };
  }

  try {
    await syncMissionRewardsForUser(pending.affiliate_user_id);
  } catch (error) {
    console.warn("[growth-referral] Failed to sync mission rewards after qualify", {
      referrerId: pending.affiliate_user_id.toString(),
      error,
    });
  }

  return { qualified: true };
}

function displayName(user: {
  first_name: string | null;
  last_name: string | null;
}): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name || "Ontap user";
}

export async function getMissionsPayload(userId: bigint | number, appUrl: string) {
  const uid = BigInt(userId);

  try {
    await syncMissionRewardsForUser(uid);
  } catch (error) {
    console.warn("[growth-referral] Failed to sync mission rewards on payload", {
      userId: uid.toString(),
      error,
    });
  }

  const affiliateCode = await getOrGenerateAffiliateCode(uid);

  const [total, qualified, pending, activity] = await Promise.all([
    prisma.referral.count({ where: { affiliate_user_id: uid } }),
    prisma.referral.count({
      where: { affiliate_user_id: uid, status: REFERRAL_STATUS_QUALIFIED },
    }),
    prisma.referral.count({
      where: { affiliate_user_id: uid, status: REFERRAL_STATUS_PENDING },
    }),
    prisma.referral.findMany({
      where: { affiliate_user_id: uid },
      orderBy: { created_at: "desc" },
      take: 50,
      select: {
        id: true,
        status: true,
        qualification_source: true,
        created_at: true,
        conversion_date: true,
        referredUser: {
          select: { first_name: true, last_name: true },
        },
      },
    }),
  ]);

  let missions;
  let milestones;

  try {
    const loaded = await loadMissionsProgressForUser(uid, qualified);
    if (loaded.missions.length > 0) {
      missions = loaded.missions;
      milestones = loaded.milestones;
    }
  } catch (error) {
    console.warn("[growth-referral] Failed to load DB missions", error);
  }

  if (!missions || missions.length === 0) {
    const incomplete = MISSION_DEFINITIONS.filter((d) => qualified < d.target);
    const nextKey =
      incomplete.length > 0
        ? incomplete.reduce((a, b) => (a.target <= b.target ? a : b)).key
        : null;
    missions = MISSION_DEFINITIONS.map((def) => {
      const completed = qualified >= def.target;
      const status = completed
        ? ("completed" as const)
        : nextKey === def.key
          ? ("next_milestone" as const)
          : ("in_progress" as const);
      return {
        key: def.key,
        title: def.title,
        description: def.description,
        instruction: def.instruction,
        requirement_type: "qualified_referrals",
        current: Math.min(qualified, def.target),
        target: def.target,
        completed,
        status,
        reward_label: def.reward_label,
        reward: null,
      };
    });
    milestones = missions.map((m) => ({
      key: m.key,
      title: m.title,
      target: m.target,
      completed: m.completed,
    }));
  }

  const featuredTarget =
    milestones && milestones.length > 0
      ? Math.max(...milestones.map((m) => m.target))
      : 10;
  const nextIncomplete = missions.find((m) => !m.completed);
  const nextRewardLabel =
    nextIncomplete?.reward?.name ||
    nextIncomplete?.reward_label ||
    missions[missions.length - 1]?.reward?.name ||
    missions[missions.length - 1]?.reward_label ||
    "Reward";
  const currentMilestoneTitle = nextIncomplete?.title ?? "All milestones complete";

  return {
    referral_link: buildGrowthInviteUrl(affiliateCode, appUrl),
    referral_code: affiliateCode,
    progress: {
      qualified_referrals: qualified,
      target: featuredTarget,
      next_reward_label: nextRewardLabel,
      current_milestone_title: currentMilestoneTitle,
      remaining: Math.max(0, (nextIncomplete?.target ?? featuredTarget) - qualified),
      next_target: nextIncomplete?.target ?? featuredTarget,
    },
    milestones: milestones ?? [],
    stats: {
      total_referrals: total,
      qualified_referrals: qualified,
      pending_referrals: pending,
      incomplete_referrals: 0,
    },
    missions,
    activity: activity.map((row) => ({
      id: row.id.toString(),
      display_name: displayName(row.referredUser),
      status: row.status,
      qualification_source: row.qualification_source,
      created_at: row.created_at.toISOString(),
      qualified_at: row.conversion_date
        ? row.conversion_date.toISOString()
        : null,
    })),
  };
}
