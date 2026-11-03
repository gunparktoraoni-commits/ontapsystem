import { prisma } from "@/server/lib/prisma";
import {
  buildTrialUpgradePromoEmail,
  sendEmailMessage,
} from "@/server/lib/email";
import { randomId } from "@/server/lib/notifications";
import {
  TRIAL_UPGRADE_EMAILED,
  TRIAL_UPGRADE_CLAIMED,
} from "@/lib/services/premium-experience.service";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Send shortly after trial expiry (day 0–21 window). */
export const TRIAL_UPGRADE_MIN_DAYS_EXPIRED = 0;
export const TRIAL_UPGRADE_LOOKBACK_DAYS = 21;
const PAID_TIERS = ["basic", "standard", "premium", "enterprise"] as const;
/** Must stay ≤ 30 chars (NotificationEmailQueue.email_type). */
export const TRIAL_UPGRADE_EMAIL_TYPE = "trial_upg_promo";
export const TRIAL_UPGRADE_TEMPLATE = "trial-upgrade-promo";

export type TrialUpgradePromoRunResult = {
  candidates: number;
  sent: number;
  skippedPaid: number;
  skippedDeduped: number;
  skippedClaimed: number;
  skippedNoEmail: number;
  errors: number;
  dryRun: boolean;
};

function getBaseUrl(): string {
  const explicit =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.FRONTEND_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) {
    return vercelUrl.startsWith("http")
      ? vercelUrl.replace(/\/$/, "")
      : `https://${vercelUrl}`;
  }
  return "http://localhost:3000";
}

async function userHasActivePaidBizcard(userId: bigint, now: Date): Promise<boolean> {
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

async function alreadyQueuedOrSent(userId: bigint): Promise<boolean> {
  const hit = await prisma.notificationEmailQueue.findFirst({
    where: {
      user_id: userId,
      email_type: TRIAL_UPGRADE_EMAIL_TYPE,
      status: { in: ["queued", "sent", "sending"] },
    },
    select: { id: true },
  });
  return Boolean(hit);
}

/**
 * Email expired free-trial users: Basic/Standard BizCard unlocks 1 month of Premium.
 */
export async function runTrialUpgradePromo(
  now: Date = new Date(),
  options: { limit?: number; dryRun?: boolean } = {},
): Promise<TrialUpgradePromoRunResult> {
  const limit = Math.min(100, Math.max(1, options.limit ?? 40));
  const dryRun = Boolean(options.dryRun);
  const expiredBefore = new Date(now.getTime() - TRIAL_UPGRADE_MIN_DAYS_EXPIRED * DAY_MS);
  const lookbackStart = new Date(now.getTime() - TRIAL_UPGRADE_LOOKBACK_DAYS * DAY_MS);

  const users = await prisma.user.findMany({
    where: {
      is_active: true,
      deactivated_flag: false,
      deleted_at: null,
      is_trial_used: true,
      trial_end: {
        not: null,
        lte: expiredBefore,
        gte: lookbackStart,
      },
      trial_upgrade_promo_status: null,
      OR: [
        { notificationPreference: null },
        { notificationPreference: { unsubscribed_at: null } },
      ],
    },
    select: {
      user_id: true,
      email: true,
      first_name: true,
      trial_end: true,
      trial_upgrade_promo_status: true,
    },
    orderBy: { trial_end: "asc" },
    take: limit * 4,
  });

  const result: TrialUpgradePromoRunResult = {
    candidates: 0,
    sent: 0,
    skippedPaid: 0,
    skippedDeduped: 0,
    skippedClaimed: 0,
    skippedNoEmail: 0,
    errors: 0,
    dryRun,
  };

  const shopUrl = `${getBaseUrl()}/user/emarket?tab=subscription`;
  const plansUrl = `${getBaseUrl()}/user/emarket?tab=subscription&promo=trial-upgrade`;

  for (const user of users) {
    if (result.sent + result.errors >= limit && !dryRun) break;
    if (result.candidates >= limit && dryRun) break;

    if (!user.email?.trim() || !user.trial_end) {
      result.skippedNoEmail += 1;
      continue;
    }
    if (user.trial_upgrade_promo_status === TRIAL_UPGRADE_CLAIMED) {
      result.skippedClaimed += 1;
      continue;
    }
    if (user.trial_upgrade_promo_status === TRIAL_UPGRADE_EMAILED) {
      result.skippedDeduped += 1;
      continue;
    }
    if (await userHasActivePaidBizcard(user.user_id, now)) {
      result.skippedPaid += 1;
      continue;
    }
    if (await alreadyQueuedOrSent(user.user_id)) {
      result.skippedDeduped += 1;
      continue;
    }

    result.candidates += 1;
    if (dryRun) continue;

    try {
      const daysExpired = Math.max(
        0,
        Math.floor((now.getTime() - user.trial_end.getTime()) / DAY_MS),
      );
      const rendered = buildTrialUpgradePromoEmail({
        firstName: user.first_name || "there",
        daysExpired,
        shopUrl,
        plansUrl,
      });

      await sendEmailMessage({
        to: user.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });

      await prisma.notificationEmailQueue.create({
        data: {
          id: randomId("email"),
          user_id: user.user_id,
          email_type: TRIAL_UPGRADE_EMAIL_TYPE,
          priority: 40,
          subject: rendered.subject,
          template_name: TRIAL_UPGRADE_TEMPLATE,
          template_data: JSON.stringify({
            days_expired: daysExpired,
            trial_end: user.trial_end.toISOString(),
            shop_url: shopUrl,
            plans_url: plansUrl,
          }),
          recipient_email: user.email,
          recipient_name: user.first_name,
          status: "sent",
          sent_at: now,
          attempts: 1,
        },
      });

      await prisma.user.update({
        where: { user_id: user.user_id },
        data: {
          trial_upgrade_promo_status: TRIAL_UPGRADE_EMAILED,
          trial_upgrade_promo_emailed_at: now,
        },
      });

      result.sent += 1;
    } catch (error) {
      result.errors += 1;
      console.error(
        "[trial-upgrade-promo] send failed",
        user.user_id.toString(),
        error,
      );
    }
  }

  return result;
}
