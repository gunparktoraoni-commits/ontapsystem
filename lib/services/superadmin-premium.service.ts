import { prisma } from "@/server/lib/prisma";
import {
  isSuperAdminRole,
  PERMANENT_PREMIUM_EXPIRES_AT,
} from "@/lib/auth/privileged-premium";

const PREMIUM_TIER = "premium";

function needsPremiumUpgrade(card: {
  subscription_tier: string | null;
  subscription_status: string | null;
  subscription_expires_at: Date | null;
}): boolean {
  const tier = String(card.subscription_tier ?? "")
    .trim()
    .toLowerCase();
  const status = String(card.subscription_status ?? "")
    .trim()
    .toLowerCase();
  const expiresAt = card.subscription_expires_at;

  if (tier !== PREMIUM_TIER) return true;
  if (status !== "active") return true;
  if (!expiresAt || expiresAt.getTime() < PERMANENT_PREMIUM_EXPIRES_AT.getTime()) {
    return true;
  }
  return false;
}

/**
 * Ensure every bizcard owned by a super_admin has permanent premium.
 * Safe to call repeatedly (idempotent).
 */
export async function ensureSuperadminBizcardsPremium(
  userId: string | bigint,
): Promise<{ updated: number }> {
  const userKey = typeof userId === "string" ? BigInt(userId) : userId;

  const user = await prisma.user.findUnique({
    where: { user_id: userKey },
    select: { role: true },
  });

  if (!user || !isSuperAdminRole(user.role)) {
    return { updated: 0 };
  }

  const cards = await prisma.bizcard.findMany({
    where: {
      user_id: userKey,
      deactivated_flag: false,
      deleted_at: null,
    },
    select: {
      bizcard_id: true,
      subscription_tier: true,
      subscription_status: true,
      subscription_expires_at: true,
    },
  });

  const toUpdate = cards.filter(needsPremiumUpgrade);
  if (toUpdate.length === 0) {
    return { updated: 0 };
  }

  const now = new Date();
  await prisma.bizcard.updateMany({
    where: {
      bizcard_id: { in: toUpdate.map((c) => c.bizcard_id) },
    },
    data: {
      subscription_tier: PREMIUM_TIER,
      subscription_status: "active",
      subscription_started_at: now,
      subscription_expires_at: PERMANENT_PREMIUM_EXPIRES_AT,
      updated_at: now,
    },
  });

  // Keep marketplace subscription rows in sync when present (best-effort).
  const premiumPlan = await prisma.subscriptionPlan.findFirst({
    where: { tier_code: "premium", is_active: true },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  if (premiumPlan) {
    for (const card of toUpdate) {
      await prisma.bizcardSubscription.upsert({
        where: { bizcard_id: card.bizcard_id },
        create: {
          bizcard_id: card.bizcard_id,
          plan_id: premiumPlan.id,
          status: "active",
          billing_cycle: "yearly",
          started_at: now,
          expires_at: PERMANENT_PREMIUM_EXPIRES_AT,
          auto_renew: false,
        },
        update: {
          plan_id: premiumPlan.id,
          status: "active",
          expires_at: PERMANENT_PREMIUM_EXPIRES_AT,
          cancelled_at: null,
          updated_at: now,
        },
      });
    }
  }

  return { updated: toUpdate.length };
}

/**
 * Backfill permanent premium for all active super_admin users' bizcards.
 */
export async function ensureAllSuperadminBizcardsPremium(): Promise<{
  users: number;
  updatedBizcards: number;
}> {
  const superadmins = await prisma.user.findMany({
    where: { role: "super_admin", is_active: true },
    select: { user_id: true },
  });

  let updatedBizcards = 0;
  for (const admin of superadmins) {
    const result = await ensureSuperadminBizcardsPremium(admin.user_id);
    updatedBizcards += result.updated;
  }

  return { users: superadmins.length, updatedBizcards };
}
