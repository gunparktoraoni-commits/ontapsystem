import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";

const REFERRAL_STATUS_QUALIFIED = "qualified";

export const REWARD_TYPE_PREMIUM = "premium_access";
export const REWARD_TYPE_THEME = "theme_access";
export const REWARD_TYPE_FEATURE = "feature_access";

export const REWARD_STATUS_ACTIVE = "active";
export const REWARD_STATUS_INACTIVE = "inactive";

export const MISSION_STATUS_ACTIVE = "active";
export const MISSION_REQUIREMENT_QUALIFIED = "qualified_referrals";

export const USER_REWARD_STATUS_UNLOCKED = "unlocked";

export const ALLOWED_REWARD_TYPES = new Set([
  REWARD_TYPE_PREMIUM,
  REWARD_TYPE_THEME,
  REWARD_TYPE_FEATURE,
]);

const DEFAULT_QUALIFIED_INSTRUCTION =
  "1. Share your Ontap referral link.\n2. A new user joins through your referral.\n3. That user completes a qualifying Ontap purchase or subscription.\n4. The referral becomes qualified.\n5. Reach the target number of qualified referrals to complete this mission.";

/**
 * Grant UserReward rows for any active mission whose target the user has met.
 * Idempotent via @@unique([user_id, mission_id]).
 */
export async function syncMissionRewardsForUser(
  userId: bigint | number,
): Promise<{ granted: number }> {
  const uid = BigInt(userId);

  const [qualified, missions] = await Promise.all([
    prisma.referral.count({
      where: { affiliate_user_id: uid, status: REFERRAL_STATUS_QUALIFIED },
    }),
    prisma.mission.findMany({
      where: {
        status: MISSION_STATUS_ACTIVE,
        requirement_type: MISSION_REQUIREMENT_QUALIFIED,
        reward_id: { not: null },
      },
      include: {
        reward: { select: { id: true, status: true } },
      },
      orderBy: [{ sort_order: "asc" }, { target: "asc" }],
    }),
  ]);

  let granted = 0;
  const now = new Date();

  for (const mission of missions) {
    if (!mission.reward_id || !mission.reward) continue;
    if (mission.reward.status !== REWARD_STATUS_ACTIVE) continue;
    if (qualified < mission.target) continue;

    const existing = await prisma.userReward.findFirst({
      where: { user_id: uid, mission_id: mission.id },
      select: { id: true },
    });
    if (existing) continue;

    try {
      await prisma.userReward.create({
        data: {
          user_id: uid,
          reward_id: mission.reward_id,
          mission_id: mission.id,
          status: USER_REWARD_STATUS_UNLOCKED,
          unlocked_at: now,
        },
      });
      granted += 1;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        continue;
      }
      throw err;
    }
  }

  return { granted };
}

export type MissionRewardPreview = {
  id: string;
  name: string;
  description: string | null;
  type: string;
  status: string;
  duration_days: number | null;
  theme_id: string | null;
  theme_name: string | null;
  theme_path: string | null;
  theme_preview_image: string | null;
  theme_tag: string | null;
  feature_key: string | null;
  user_reward_status: string | null;
  user_reward_id: string | null;
};

export type MissionProgressItem = {
  key: string;
  title: string;
  description: string;
  instruction: string;
  requirement_type: string;
  target: number;
  current: number;
  completed: boolean;
  status: "completed" | "next_milestone" | "in_progress";
  reward_label: string;
  reward: MissionRewardPreview | null;
};

export type MissionMilestone = {
  key: string;
  title: string;
  target: number;
  completed: boolean;
};

/**
 * Load active missions with catalog reward preview + per-user UserReward state.
 */
export async function loadMissionsProgressForUser(
  userId: bigint | number,
  qualifiedCount: number,
): Promise<{
  missions: MissionProgressItem[];
  milestones: MissionMilestone[];
}> {
  const uid = BigInt(userId);

  const rows = await prisma.mission.findMany({
    where: { status: MISSION_STATUS_ACTIVE },
    include: {
      reward: {
        include: {
          theme: {
            select: {
              id: true,
              theme_name: true,
              theme_path: true,
              preview_image: true,
              tag: true,
            },
          },
        },
      },
      userRewards: {
        where: { user_id: uid },
        take: 1,
        select: { id: true, status: true },
      },
    },
    orderBy: [{ sort_order: "asc" }, { target: "asc" }],
  });

  const incomplete = rows.filter((m) => qualifiedCount < m.target);
  const nextKey =
    incomplete.length > 0
      ? incomplete.reduce((a, b) => (a.target <= b.target ? a : b)).key
      : null;

  const missions: MissionProgressItem[] = rows.map((m) => {
    const completed = qualifiedCount >= m.target;
    const current = Math.min(qualifiedCount, m.target);
    const ur = m.userRewards[0] ?? null;
    const reward = m.reward
      ? {
          id: m.reward.id.toString(),
          name: m.reward.name,
          description: m.reward.description,
          type: m.reward.type,
          status: m.reward.status,
          duration_days: m.reward.duration_days,
          theme_id: m.reward.theme_id?.toString() ?? null,
          theme_name: m.reward.theme?.theme_name ?? null,
          theme_path: m.reward.theme?.theme_path ?? null,
          theme_preview_image: m.reward.theme?.preview_image ?? null,
          theme_tag: m.reward.theme?.tag ?? null,
          feature_key: m.reward.feature_key,
          user_reward_status: ur?.status ?? null,
          user_reward_id: ur?.id?.toString() ?? null,
        }
      : null;

    let status: MissionProgressItem["status"] = "in_progress";
    if (completed) status = "completed";
    else if (nextKey && m.key === nextKey) status = "next_milestone";

    return {
      key: m.key,
      title: m.title,
      description: m.description ?? "",
      instruction:
        m.instruction?.trim() ||
        (m.requirement_type === MISSION_REQUIREMENT_QUALIFIED
          ? DEFAULT_QUALIFIED_INSTRUCTION
          : ""),
      requirement_type: m.requirement_type,
      target: m.target,
      current,
      completed,
      status,
      reward_label: reward?.name ?? "",
      reward,
    };
  });

  const milestones: MissionMilestone[] = missions.map((m) => ({
    key: m.key,
    title: m.title,
    target: m.target,
    completed: m.completed,
  }));

  return { missions, milestones };
}

/** @deprecated Prefer loadMissionsProgressForUser — kept for fallbacks */
export async function loadActiveMissionProgressDefinitions() {
  const rows = await prisma.mission.findMany({
    where: { status: MISSION_STATUS_ACTIVE },
    include: { reward: { select: { name: true, status: true } } },
    orderBy: [{ sort_order: "asc" }, { target: "asc" }],
  });

  return rows.map((m) => ({
    key: m.key,
    title: m.title,
    description: m.description ?? "",
    instruction: m.instruction ?? DEFAULT_QUALIFIED_INSTRUCTION,
    requirement_type: m.requirement_type,
    target: m.target,
    reward_label:
      m.reward?.status === REWARD_STATUS_ACTIVE
        ? m.reward.name
        : (m.reward?.name ?? ""),
  }));
}

export async function getUserRewardsPayload(userId: bigint | number) {
  const uid = BigInt(userId);
  await syncMissionRewardsForUser(uid);

  const rows = await prisma.userReward.findMany({
    where: { user_id: uid },
    orderBy: { unlocked_at: "desc" },
    include: {
      reward: {
        include: {
          theme: {
            select: {
              theme_name: true,
              theme_path: true,
              preview_image: true,
              tag: true,
            },
          },
        },
      },
      mission: { select: { key: true, title: true } },
    },
  });

  return {
    rewards: rows.map((row) => ({
      id: row.id.toString(),
      reward_id: row.reward_id.toString(),
      name: row.reward.name,
      description: row.reward.description,
      type: row.reward.type,
      status: row.status,
      unlocked_at: row.unlocked_at.toISOString(),
      claimed_at: row.claimed_at ? row.claimed_at.toISOString() : null,
      expires_at: row.expires_at ? row.expires_at.toISOString() : null,
      mission_key: row.mission?.key ?? null,
      mission_title: row.mission?.title ?? null,
      duration_days: row.reward.duration_days,
      theme_name: row.reward.theme?.theme_name ?? null,
      theme_path: row.reward.theme?.theme_path ?? null,
      theme_preview_image: row.reward.theme?.preview_image ?? null,
      theme_tag: row.reward.theme?.tag ?? null,
      feature_key: row.reward.feature_key,
      redeemable: false,
    })),
  };
}

export function slugifyMissionKey(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return base || `mission_${Date.now()}`;
}

export async function ensureUniqueMissionKey(base: string): Promise<string> {
  let key = base;
  let n = 0;
  while (true) {
    const existing = await prisma.mission.findUnique({
      where: { key },
      select: { id: true },
    });
    if (!existing) return key;
    n += 1;
    key = `${base}_${n}`.slice(0, 80);
  }
}
