import { parseBizcardSubscriptionTier, type BizcardSubscriptionTier } from "@/lib/bizcard/tiers";
import { updateUserSubscriptionFlags } from "@/lib/auth/subscription-guards";
import { QRCodeService } from "@/lib/services/qr-code.service";
import { prisma } from "@/server/lib/prisma";
import { buildVCardPublicUrl } from "@/server/lib/qr";
import { isUserCurrentlyOnline } from "@/server/lib/user-presence";
import { revokeAllSessions } from "@/server/lib/auth";
export type SuperAdminUserBizcardsFilters = {
  page: number;
  limit: number;
  search?: string;
  status?: "all" | "active" | "restricted";
};

export type SuperAdminRecycleBinFilters = {
  page: number;
  limit: number;
  search?: string;
};

export type SuperAdminUserBizcardRow = {
  bizcard_id: string;
  user_id: string;
  user_email: string | null;
  serial_id: string | null;
  name: string;
  subscription_tier: string | null;
  subscription_plan_name: string | null;
  subscription_status: string | null;
  qr_code_url: string | null;
  portfolio_url: string | null;
  restricted: boolean;
  created_at: string;
  updated_at: string;
  owner_is_online: boolean;
  owner_last_active: string | null;
  owner_session_status: "online" | "offline";
  city: string | null;
  region: string | null;
};

export type SuperAdminRecycleBinRow = SuperAdminUserBizcardRow & {
  deleted_at: string;
};

export type SuperAdminUserBizcardDetail = SuperAdminUserBizcardRow & {
  url_alias: string | null;
  portfolio_url_editable: boolean;
};

export type SuperAdminUserBizcardUpdateInput = {
  subscription_tier?: string;
  portfolio_url?: string;
};

function normalizeName(input: {
  first_name: string | null;
  last_name: string | null;
  bizcard_name: string | null;
}): string {
  const full = [input.first_name?.trim(), input.last_name?.trim()]
    .filter(Boolean)
    .join(" ")
    .trim();
  return full || input.bizcard_name?.trim() || "Unnamed BizCard";
}

function mapSuperAdminUserBizcardRow(row: {
  bizcard_id: bigint;
  user_id: bigint | null;
  serial_id: string | null;
  bizcard_name: string;
  first_name: string;
  last_name: string;
  email: string;
  subscription_tier: string | null;
  subscription_status: string | null;
  qr_code_url: string | null;
  deactivated_flag: boolean;
  url_alias: string | null;
  portfolio_url: string | null;
  created_at: Date;
  updated_at: Date | null;
  city: string | null;
  region: string | null;
  user: { email: string | null; is_online: boolean; last_active: Date | null } | null;
  marketplaceSubscription: {
    status: string;
    plan: { name: string; tier_code: string } | null;
  } | null;
}): SuperAdminUserBizcardRow {
  const ownerOnline = isUserCurrentlyOnline({
    is_online: row.user?.is_online ?? false,
    last_active: row.user?.last_active ?? null,
  });

  return {
    bizcard_id: row.bizcard_id.toString(),
    user_id: row.user_id?.toString() ?? "",
    user_email: row.user?.email ?? row.email ?? null,
    serial_id: row.serial_id,
    name: normalizeName(row),
    subscription_tier: resolveDisplayedSubscriptionTier(
      row.marketplaceSubscription?.plan?.tier_code,
      row.subscription_tier,
    ),
    subscription_plan_name: row.marketplaceSubscription?.plan?.name ?? null,
    subscription_status:
      row.marketplaceSubscription?.status ?? row.subscription_status ?? null,
    qr_code_url: row.qr_code_url,
    portfolio_url:
      row.url_alias ? buildVCardPublicUrl(row.url_alias) : row.portfolio_url,
    restricted: row.deactivated_flag,
    created_at: row.created_at.toISOString(),
    updated_at: (row.updated_at ?? row.created_at).toISOString(),
    owner_is_online: ownerOnline,
    owner_last_active: row.user?.last_active?.toISOString() ?? null,
    owner_session_status: ownerOnline ? "online" : "offline",
    city: row.city?.trim() || null,
    region: row.region?.trim() || null,
  };
}

const claimedBizcardSelect = {
  bizcard_id: true,
  user_id: true,
  serial_id: true,
  bizcard_name: true,
  first_name: true,
  last_name: true,
  email: true,
  subscription_tier: true,
  subscription_status: true,
  qr_code_url: true,
  deactivated_flag: true,
  url_alias: true,
  portfolio_url: true,
  created_at: true,
  updated_at: true,
  city: true,
  region: true,
  user: {
    select: {
      email: true,
      is_online: true,
      last_active: true,
    },
  },
  marketplaceSubscription: {
    select: {
      status: true,
      plan: {
        select: {
          name: true,
          tier_code: true,
        },
      },
    },
  },
} as const;

function resolveDisplayedSubscriptionTier(
  marketplaceTier: string | null | undefined,
  bizcardTier: string | null | undefined,
): string | null {
  const market = String(marketplaceTier ?? "").trim().toLowerCase();
  const card = String(bizcardTier ?? "").trim().toLowerCase();
  const marketIsTrial = !market || market === "free_trial" || market === "none";
  if (!marketIsTrial) return market;
  return card || marketplaceTier || null;
}

/**
 * Superadmin override: persist the selected paid tier on the bizcard AND the
 * marketplace subscription row, then end any active free trial so access
 * checks and /api/user/subscription stop reporting "Free Trial".
 */
export async function applySuperAdminSubscriptionOverride(params: {
  bizcardId: bigint;
  userId: bigint;
  tier: BizcardSubscriptionTier;
}): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  const plan = await prisma.subscriptionPlan.findUnique({
    where: { tier_code: params.tier },
    select: { id: true, is_trial: true },
  });
  if (!plan || plan.is_trial) {
    throw new Error("INVALID_SUBSCRIPTION_TIER");
  }

  const previous = await prisma.bizcardSubscription.findUnique({
    where: { bizcard_id: params.bizcardId },
    select: { plan_id: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.bizcard.update({
      where: { bizcard_id: params.bizcardId },
      data: {
        subscription_tier: params.tier,
        subscription_status: "active",
        subscription_started_at: now,
        subscription_expires_at: expiresAt,
        updated_at: now,
      },
    });

    await tx.bizcardSubscription.upsert({
      where: { bizcard_id: params.bizcardId },
      create: {
        bizcard_id: params.bizcardId,
        plan_id: plan.id,
        status: "active",
        billing_cycle: "yearly",
        started_at: now,
        expires_at: expiresAt,
        auto_renew: false,
      },
      update: {
        plan_id: plan.id,
        status: "active",
        billing_cycle: "yearly",
        started_at: now,
        expires_at: expiresAt,
        cancelled_at: null,
        auto_renew: false,
        updated_at: now,
      },
    });

    await tx.subscriptionUpgradeLog.create({
      data: {
        bizcard_id: params.bizcardId,
        from_plan_id: previous?.plan_id ?? undefined,
        to_plan_id: plan.id,
        upgrade_type: "superadmin_override",
        billing_cycle: "yearly",
        effective_date: now,
        expiry_date: expiresAt,
      },
    });

    const owner = await tx.user.findUnique({
      where: { user_id: params.userId },
      select: { trial_end: true },
    });
    if (owner?.trial_end && owner.trial_end > now) {
      await tx.user.update({
        where: { user_id: params.userId },
        data: {
          trial_end: now,
          updated_at: now,
        },
      });
    }
  });

  await updateUserSubscriptionFlags(params.userId);

  try {
    const { archiveSubscriptionExpiryWarnings } = await import(
      "@/lib/services/subscription-expiry-reminder.service"
    );
    await archiveSubscriptionExpiryWarnings(params.userId);
  } catch (error) {
    console.error(
      `[SUPERADMIN_BIZCARDS] Failed to archive expiry warnings after tier override for user ${params.userId.toString()}:`,
      error,
    );
  }
}

function isValidPortfolioUrl(value: string): boolean {
  const raw = value.trim();
  if (!raw || raw.length > 512) return false;
  if (!raw.startsWith("http://") && !raw.startsWith("https://") && !raw.startsWith("/")) {
    return false;
  }
  try {
    new URL(raw, "https://example.com");
    return true;
  } catch {
    return false;
  }
}

export async function listSuperAdminUserBizcards(
  filters: SuperAdminUserBizcardsFilters,
): Promise<{
  rows: SuperAdminUserBizcardRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    has_next: boolean;
    has_previous: boolean;
  };
  summary: {
    total_active: number;
    total_restricted: number;
    with_serial_id: number;
    without_serial_id: number;
  };
}> {
  const page = Math.max(1, filters.page);
  const limit = Math.max(1, Math.min(filters.limit, 100));
  const skip = (page - 1) * limit;
  const search = filters.search?.trim();

  // Base where clause for claimed bizcards (no status filter, no search).
  // Used for global summary counts that are independent of the current filter.
  // Soft-deleted users/bizcards are excluded from the active User BizCards list.
  const baseWhere = {
    is_blank: false,
    user_id: { not: null },
    deleted_at: null,
    user: { deleted_at: null },
  } as const;

  const where = {
    is_blank: false,
    user_id: { not: null },
    deleted_at: null,
    user: { deleted_at: null },
    ...(filters.status === "active"
      ? { deactivated_flag: false }
      : filters.status === "restricted"
        ? { deactivated_flag: true }
        : {}),
    ...(search
      ? {
          OR: [
            { serial_id: { contains: search } },
            { bizcard_name: { contains: search } },
            { first_name: { contains: search } },
            { last_name: { contains: search } },
            { url_alias: { contains: search } },
            { email: { contains: search } },
            { user: { email: { contains: search }, deleted_at: null } },
          ],
        }
      : {}),
  } as const;

  // Run all queries in parallel: page rows, filtered total, global active count,
  // global restricted count. The global counts intentionally ignore the current
  // status filter and search so the metric cards reflect system-wide reality.
  const [rows, total, totalActive, totalRestricted, withSerialId, withoutSerialId] =
    await Promise.all([
      prisma.bizcard.findMany({
        where,
        orderBy: [{ created_at: "desc" }, { bizcard_id: "desc" }],
        skip,
        take: limit,
        select: claimedBizcardSelect,
      }),
      prisma.bizcard.count({ where }),
      prisma.bizcard.count({ where: { ...baseWhere, deactivated_flag: false } }),
      prisma.bizcard.count({ where: { ...baseWhere, deactivated_flag: true } }),
      prisma.bizcard.count({
        where: {
          ...baseWhere,
          AND: [{ serial_id: { not: null } }, { serial_id: { not: "" } }],
        },
      }),
      prisma.bizcard.count({
        where: {
          ...baseWhere,
          OR: [{ serial_id: null }, { serial_id: "" }],
        },
      }),
    ]);

  const pages = Math.max(1, Math.ceil(total / limit));

  return {
    rows: rows.map((row) => mapSuperAdminUserBizcardRow(row)),
    pagination: {
      page,
      limit,
      total,
      pages,
      has_next: page < pages,
      has_previous: page > 1,
    },
    summary: {
      total_active: totalActive,
      total_restricted: totalRestricted,
      with_serial_id: withSerialId,
      without_serial_id: withoutSerialId,
    },
  };
}

export async function getSuperAdminUserBizcard(
  bizcardId: bigint,
): Promise<SuperAdminUserBizcardDetail | null> {
  const row = await prisma.bizcard.findFirst({
    where: {
      bizcard_id: bizcardId,
      is_blank: false,
      user_id: { not: null },
      deleted_at: null,
      user: { deleted_at: null },
    },
    select: claimedBizcardSelect,
  });

  if (!row) return null;

  const mapped = mapSuperAdminUserBizcardRow(row);
  return {
    ...mapped,
    url_alias: row.url_alias,
    portfolio_url_editable: !row.url_alias,
  };
}

export async function updateSuperAdminUserBizcard(
  bizcardId: bigint,
  input: SuperAdminUserBizcardUpdateInput,
  requestId: string,
): Promise<SuperAdminUserBizcardDetail> {
  const existing = await prisma.bizcard.findFirst({
    where: {
      bizcard_id: bizcardId,
      is_blank: false,
      user_id: { not: null },
      deleted_at: null,
      user: { deleted_at: null },
    },
    select: {
      bizcard_id: true,
      user_id: true,
      url_alias: true,
      portfolio_url: true,
      subscription_tier: true,
      qr_code_url: true,
    },
  });

  if (!existing) {
    throw new Error("BIZCARD_NOT_FOUND");
  }

  const updateData: {
    subscription_tier?: string;
    portfolio_url?: string;
    qr_code_url?: string;
    qr_code_generated_at?: Date;
    updated_at: Date;
  } = {
    updated_at: new Date(),
  };

  let nextTier: BizcardSubscriptionTier | null = null;
  if (input.subscription_tier !== undefined) {
    nextTier = parseBizcardSubscriptionTier(input.subscription_tier, { defaultOnMissing: false });
    if (!nextTier) {
      throw new Error("INVALID_SUBSCRIPTION_TIER");
    }
    updateData.subscription_tier = nextTier;
  }

  let portfolioChanged = false;
  if (input.portfolio_url !== undefined) {
    if (existing.url_alias) {
      throw new Error("PORTFOLIO_URL_LOCKED");
    }

    const portfolioUrl = input.portfolio_url.trim();
    if (!isValidPortfolioUrl(portfolioUrl)) {
      throw new Error("INVALID_PORTFOLIO_URL");
    }

    if ((existing.portfolio_url ?? "").trim() !== portfolioUrl) {
      updateData.portfolio_url = portfolioUrl;
      portfolioChanged = true;
    }
  }

  if (
    input.subscription_tier === undefined &&
    input.portfolio_url === undefined
  ) {
    throw new Error("NO_VALID_FIELDS");
  }

  if (portfolioChanged && updateData.portfolio_url) {
    const qrService = new QRCodeService(requestId);
    const qrData = await qrService.generateQRCode(bizcardId, updateData.portfolio_url);
    updateData.qr_code_url = qrData.qr_code_url;
    updateData.qr_code_generated_at = qrData.generated_at;
  }

  if (nextTier && existing.user_id) {
    await applySuperAdminSubscriptionOverride({
      bizcardId,
      userId: existing.user_id,
      tier: nextTier,
    });
    delete updateData.subscription_tier;
  }

  const remainingKeys = Object.keys(updateData).filter((key) => key !== "updated_at");
  if (remainingKeys.length > 0) {
    await prisma.bizcard.update({
      where: { bizcard_id: bizcardId },
      data: updateData,
    });
  }

  const refreshed = await getSuperAdminUserBizcard(bizcardId);
  if (!refreshed) {
    throw new Error("BIZCARD_NOT_FOUND");
  }

  return refreshed;
}

/**
 * Soft-deletes a user account and all claimed bizcards into the Recycle Bin.
 * Related data (services, socials, media, etc.) remains intact via FKs.
 *
 * Sets User.deleted_at + is_active=false, Bizcard.deleted_at on all claimed
 * cards for that user, and revokes all sessions. Does not touch
 * deactivated_flag / is_restricted so restrict state is preserved on restore.
 */
export async function softDeleteUserAndBizcard(bizcardId: bigint): Promise<{
  bizcard_id: string;
  user_id: string;
  serial_id: string | null;
  user_email: string | null;
}> {
  const bizcard = await prisma.bizcard.findFirst({
    where: {
      bizcard_id: bizcardId,
      is_blank: false,
      user_id: { not: null },
      deleted_at: null,
      user: { deleted_at: null },
    },
    select: {
      bizcard_id: true,
      user_id: true,
      serial_id: true,
      user: { select: { email: true } },
    },
  });

  if (!bizcard || !bizcard.user_id) {
    throw new Error("BIZCARD_NOT_FOUND");
  }

  const userId = bizcard.user_id;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { user_id: userId },
      data: {
        deleted_at: now,
        is_active: false,
        updated_at: now,
      },
    });

    await tx.bizcard.updateMany({
      where: {
        user_id: userId,
        is_blank: false,
        deleted_at: null,
      },
      data: {
        deleted_at: now,
        updated_at: now,
      },
    });
  });

  await revokeAllSessions(Number(userId));

  return {
    bizcard_id: bizcardId.toString(),
    user_id: userId.toString(),
    serial_id: bizcard.serial_id,
    user_email: bizcard.user?.email ?? null,
  };
}

/**
 * Restores a soft-deleted user and their claimed bizcards from the Recycle Bin.
 * Clears deleted_at and reactivates the account (is_active=true).
 * Leaves deactivated_flag / is_restricted unchanged.
 */
export async function restoreUserAndBizcard(bizcardId: bigint): Promise<{
  bizcard_id: string;
  user_id: string;
  serial_id: string | null;
  user_email: string | null;
}> {
  const bizcard = await prisma.bizcard.findFirst({
    where: {
      bizcard_id: bizcardId,
      is_blank: false,
      user_id: { not: null },
      deleted_at: { not: null },
    },
    select: {
      bizcard_id: true,
      user_id: true,
      serial_id: true,
      user: { select: { email: true, deleted_at: true } },
    },
  });

  if (!bizcard || !bizcard.user_id || !bizcard.user?.deleted_at) {
    throw new Error("BIZCARD_NOT_FOUND");
  }

  const userId = bizcard.user_id;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { user_id: userId },
      data: {
        deleted_at: null,
        is_active: true,
        updated_at: now,
      },
    });

    await tx.bizcard.updateMany({
      where: {
        user_id: userId,
        is_blank: false,
        deleted_at: { not: null },
      },
      data: {
        deleted_at: null,
        updated_at: now,
      },
    });
  });

  return {
    bizcard_id: bizcardId.toString(),
    user_id: userId.toString(),
    serial_id: bizcard.serial_id,
    user_email: bizcard.user?.email ?? null,
  };
}

/**
 * Lists soft-deleted claimed bizcards for the Super Admin Recycle Bin.
 */
export async function listRecycleBinUserBizcards(
  filters: SuperAdminRecycleBinFilters,
): Promise<{
  rows: SuperAdminRecycleBinRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    has_next: boolean;
    has_previous: boolean;
  };
}> {
  const page = Math.max(1, filters.page);
  const limit = Math.max(1, Math.min(filters.limit, 100));
  const skip = (page - 1) * limit;
  const search = filters.search?.trim();

  const where = {
    is_blank: false,
    user_id: { not: null },
    deleted_at: { not: null },
    user: { deleted_at: { not: null } },
    ...(search
      ? {
          OR: [
            { serial_id: { contains: search } },
            { bizcard_name: { contains: search } },
            { first_name: { contains: search } },
            { last_name: { contains: search } },
            { url_alias: { contains: search } },
            { email: { contains: search } },
            { user: { email: { contains: search }, deleted_at: { not: null } } },
          ],
        }
      : {}),
  } as const;

  const recycleSelect = {
    ...claimedBizcardSelect,
    deleted_at: true,
  } as const;

  const [rows, total] = await Promise.all([
    prisma.bizcard.findMany({
      where,
      orderBy: [{ deleted_at: "desc" }, { bizcard_id: "desc" }],
      skip,
      take: limit,
      select: recycleSelect,
    }),
    prisma.bizcard.count({ where }),
  ]);

  const pages = Math.max(1, Math.ceil(total / limit));

  return {
    rows: rows.map((row) => ({
      ...mapSuperAdminUserBizcardRow(row),
      deleted_at: (row.deleted_at ?? new Date()).toISOString(),
    })),
    pagination: {
      page,
      limit,
      total,
      pages,
      has_next: page < pages,
      has_previous: page > 1,
    },
  };
}

/**
 * Permanently deletes a user account and ALL associated data.
 *
 * Deletion order:
 *  1. Null-out nullable bizcard_id FKs on child records tied to the bizcard
 *     (Services → ServiceMedia, Socials, Products, Blogs, Addresses, QRCodeScans,
 *      BizcardMergeHistory, Inquiries) — these have no onDelete:Cascade on
 *     bizcard_id so we clear them manually first.
 *  2. Delete the Bizcard row — this cascades BizcardSubscription via its own
 *     onDelete:Cascade.
 *  3. Delete the User row — this cascades the remaining user-owned records
 *     (Sessions, Credentials, Notifications, VCardSetup, Media, etc.) via their
 *     own onDelete:Cascade relationships on user_id.
 *
 * Works for both active and soft-deleted (Recycle Bin) records.
 * Returns basic metadata for audit logging.
 */
export async function deleteUserAndBizcard(bizcardId: bigint): Promise<{
  bizcard_id: string;
  user_id: string;
  serial_id: string | null;
  user_email: string | null;
}> {
  // 1. Load the bizcard to confirm it exists and is claimed (including soft-deleted).
  const bizcard = await prisma.bizcard.findFirst({
    where: {
      bizcard_id: bizcardId,
      is_blank: false,
      user_id: { not: null },
    },
    select: {
      bizcard_id: true,
      user_id: true,
      serial_id: true,
      user: { select: { email: true } },
    },
  });

  if (!bizcard || !bizcard.user_id) {
    throw new Error("BIZCARD_NOT_FOUND");
  }

  const userId = bizcard.user_id;

  // 2. Within a transaction, delete in the correct dependency order.
  //    For permanent purge from Recycle Bin, delete ALL claimed bizcards for the
  //    user (not only the one referenced), matching soft-delete scope.
  await prisma.$transaction(async (tx) => {
    const claimedCards = await tx.bizcard.findMany({
      where: {
        user_id: userId,
        is_blank: false,
      },
      select: { bizcard_id: true },
    });
    const bizcardIds = claimedCards.map((c) => c.bizcard_id);

    if (bizcardIds.length === 0) {
      throw new Error("BIZCARD_NOT_FOUND");
    }

    await tx.service.updateMany({
      where: { bizcard_id: { in: bizcardIds } },
      data: { bizcard_id: null },
    });

    await tx.social.updateMany({
      where: { bizcard_id: { in: bizcardIds } },
      data: { bizcard_id: null },
    });

    await tx.product.updateMany({
      where: { bizcard_id: { in: bizcardIds } },
      data: { bizcard_id: null },
    });

    await tx.blog.updateMany({
      where: { bizcard_id: { in: bizcardIds } },
      data: { bizcard_id: null },
    });

    await tx.address.updateMany({
      where: { bizcard_id: { in: bizcardIds } },
      data: { bizcard_id: null },
    });

    await tx.qRCodeScan.updateMany({
      where: { bizcard_id: { in: bizcardIds } },
      data: { bizcard_id: null },
    });

    await tx.connection.updateMany({
      where: { bizcard_id: { in: bizcardIds } },
      data: { bizcard_id: null },
    });

    await tx.inquiry.updateMany({
      where: { bizcard_id: { in: bizcardIds } },
      data: { bizcard_id: null },
    });

    await tx.bizcardMergeHistory.deleteMany({
      where: {
        OR: [
          { blank_bizcard_id: { in: bizcardIds } },
          { virtual_bizcard_id: { in: bizcardIds } },
        ],
      },
    });

    await tx.bizcard.deleteMany({
      where: { bizcard_id: { in: bizcardIds } },
    });

    await tx.user.delete({
      where: { user_id: userId },
    });
  });

  return {
    bizcard_id: bizcardId.toString(),
    user_id: userId.toString(),
    serial_id: bizcard.serial_id,
    user_email: bizcard.user?.email ?? null,
  };
}

export async function setSuperAdminBizcardRestricted(
  bizcardId: bigint,
  restricted: boolean,
): Promise<{
  bizcard_id: string;
  restricted: boolean;
  user_id: string | null;
  serial_id: string | null;
}> {
  const existing = await prisma.bizcard.findFirst({
    where: {
      bizcard_id: bizcardId,
      is_blank: false,
      user_id: { not: null },
      deleted_at: null,
      user: { deleted_at: null },
    },
    select: {
      bizcard_id: true,
      user_id: true,
      serial_id: true,
      is_blank: true,
    },
  });

  if (!existing || existing.is_blank || !existing.user_id) {
    throw new Error("BIZCARD_NOT_FOUND");
  }

  const updated = await prisma.bizcard.update({
    where: { bizcard_id: bizcardId },
    data: {
      deactivated_flag: restricted,
      updated_at: new Date(),
    },
    select: {
      bizcard_id: true,
      user_id: true,
      serial_id: true,
      deactivated_flag: true,
    },
  });

  return {
    bizcard_id: updated.bizcard_id.toString(),
    restricted: updated.deactivated_flag,
    user_id: updated.user_id?.toString() ?? null,
    serial_id: updated.serial_id,
  };
}
