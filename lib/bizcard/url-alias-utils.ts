/**
 * Bizcard URL Alias Utilities
 * Provides helper functions for:
 * - Identifying placeholder vs. user-created bizcards
 * - Calculating URL alias edit eligibility (90-day window)
 */

import type { Bizcard } from "@prisma/client";

/**
 * Normalize a URL alias to a clean slug:
 * lowercase, spaces → hyphens, strip invalid chars, collapse hyphens.
 * Does not enforce start/end hyphen rules — callers validate with CUSTOM_URI_REGEX.
 */
export function sanitizeUrlAlias(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Check if a bizcard is a system-generated placeholder.
 * Placeholders are bizcards that were auto-created but not yet claimed/filled by the user.
 *
 * @param bizcard - The bizcard to check
 * @returns true if the bizcard is a placeholder (system-generated, not claimed)
 */
export function isPlaceholderBizcard(bizcard: Partial<Bizcard> | null | undefined): boolean {
  if (!bizcard) return false;
  
  // A placeholder is:
  // - is_blank = true, OR
  // - generated_by_user_id is set but claimed_by_user_id is NULL (auto-generated but not claimed)
  return (
    bizcard.is_blank === true ||
    (bizcard.generated_by_user_id != null && bizcard.claimed_by_user_id == null)
  );
}

/**
 * System-generated placeholder URL aliases (e.g. user-42, user-42-2).
 */
export function isSystemPlaceholderAlias(alias: string | null | undefined): boolean {
  if (!alias) return true;
  return /^user-\d+(-\d+)?$/i.test(alias.trim());
}

/**
 * Check if a bizcard was created/claimed by a specific user.
 * User-created bizcards are the ones shown in the user's bizcard list.
 *
 * @param bizcard - The bizcard to check
 * @param userId - The user ID to compare against
 * @returns true if the bizcard is claimed/owned by the user
 */
export function isUserCreatedBizcard(
  bizcard: Partial<Bizcard> | null | undefined,
  userId: bigint | null | undefined
): boolean {
  if (!bizcard || userId == null) return false;
  
  // User-created means:
  // - is_blank = false AND
  // - claimed_by_user_id = userId (or user_id = userId for older records)
  return bizcard.is_blank === false && (bizcard.claimed_by_user_id === userId || bizcard.user_id === userId);
}

/**
 * URL alias edit eligibility result.
 */
export interface UrlAliasEditEligibility {
  /** true if the user can change the URL alias right now */
  allowed: boolean;
  /** number of days remaining before change is allowed (0 if allowed) */
  daysRemaining: number;
  /** Date when the next URL alias change becomes available */
  changeAvailableAt: Date;
}

/**
 * Calculate URL alias edit eligibility based on the 90-day rule.
 * The 90-day window is tracked from the last time the URL alias was changed,
 * or from the bizcard creation date if it has never been changed.
 *
 * @param bizcard - The bizcard to check
 * @returns Eligibility info including whether change is allowed and days remaining
 */
export function canChangeUrlAlias(
  bizcard: Partial<Bizcard> | null | undefined
): UrlAliasEditEligibility {
  if (!bizcard) {
    return {
      allowed: false,
      daysRemaining: 90,
      changeAvailableAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    };
  }

  if (isPlaceholderBizcard(bizcard)) {
    return {
      allowed: true,
      daysRemaining: 0,
      changeAvailableAt: new Date(),
    };
  }

  // Use last_url_alias_changed_at if available, otherwise fall back to created_at
  const lastChangeDate = bizcard.last_url_alias_changed_at || bizcard.created_at;

  if (!lastChangeDate) {
    // No date available, assume change is allowed
    return {
      allowed: true,
      daysRemaining: 0,
      changeAvailableAt: new Date(),
    };
  }

  // Calculate when the next change becomes available (90 days from last change)
  const ninetyDaysLater = new Date(lastChangeDate.getTime() + 90 * 24 * 60 * 60 * 1000);
  const now = new Date();

  // Check if 90 days have passed
  const allowed = now >= ninetyDaysLater;

  // Calculate days remaining (round up)
  let daysRemaining = 0;
  if (!allowed) {
    const msRemaining = ninetyDaysLater.getTime() - now.getTime();
    daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
  }

  return {
    allowed,
    daysRemaining,
    changeAvailableAt: ninetyDaysLater,
  };
}

/**
 * Format the URL alias edit eligibility for API responses.
 * Converts dates to ISO strings and rounds numeric values.
 *
 * @param eligibility - The eligibility object from canChangeUrlAlias
 * @returns Serializable eligibility object with ISO date strings
 */
export function serializeUrlAliasEligibility(eligibility: UrlAliasEditEligibility) {
  return {
    allowed: eligibility.allowed,
    daysRemaining: eligibility.daysRemaining,
    changeAvailableAt: eligibility.changeAvailableAt.toISOString(),
  };
}

const URL_ALIAS_LOCK_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Start the 90-day URL alias lock for migrated / unstamped non-placeholder bizcards.
 * Idempotent:
 * - rows with `last_url_alias_changed_at = null` are stamped to now
 * - rows backfilled with `last_url_alias_changed_at = created_at` whose 90-day
 *   window from `created_at` has already expired are restamped to now
 *   (fixes the 20260605 migration that copied created_at and left old cards unlocked)
 * Skips blank/unclaimed placeholders so new users remain editable until first real alias claim.
 *
 * Call on successful login (password or WebAuthn) or reauth session creation.
 */
export async function ensureAliasLockStarted(userId: bigint): Promise<number> {
  const { prisma } = await import("@/server/lib/prisma");
  const { Prisma } = await import("@prisma/client");
  const now = new Date();
  const lockExpiredBefore = new Date(now.getTime() - URL_ALIAS_LOCK_MS);

  const nullStamp = await prisma.bizcard.updateMany({
    where: {
      user_id: userId,
      last_url_alias_changed_at: null,
      is_blank: false,
      OR: [
        { generated_by_user_id: null },
        { claimed_by_user_id: { not: null } },
      ],
    },
    data: {
      last_url_alias_changed_at: now,
    },
  });

  // Column-to-column compare requires raw SQL (Prisma where cannot express field = field).
  // Only restamp expired backfills so recently created cards (both timestamps ~equal) are not
  // restamped on every login.
  const backfillStamp = await prisma.$executeRaw(
    Prisma.sql`
      UPDATE Bizcard
      SET last_url_alias_changed_at = ${now}
      WHERE user_id = ${userId}
        AND is_blank = false
        AND last_url_alias_changed_at IS NOT NULL
        AND last_url_alias_changed_at = created_at
        AND created_at < ${lockExpiredBefore}
        AND (generated_by_user_id IS NULL OR claimed_by_user_id IS NOT NULL)
    `
  );

  return nullStamp.count + Number(backfillStamp);
}

/**
 * Check if a bizcard should be included in the user's bizcard list.
 * Filters out system-generated placeholders and shows only user-owned/created cards.
 *
 * @param bizcard - The bizcard to check
 * @param userId - The user ID (for filtering user-created cards)
 * @returns true if the bizcard should be visible to the user
 */
export function shouldShowBizcardInList(
  bizcard: Partial<Bizcard> | null | undefined,
  userId: bigint | null | undefined
): boolean {
  // Don't show placeholders, only user-created bizcards
  return !isPlaceholderBizcard(bizcard) && isUserCreatedBizcard(bizcard, userId);
}
