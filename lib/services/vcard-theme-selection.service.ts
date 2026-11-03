// lib/backend/services/vcard-theme-selection.service.ts
import { prisma } from "@/server/lib/prisma";
import { cacheDelPrefix } from "@/lib/vcard/cache";
import { invalidateCache, generateCacheKey } from "@/lib/cache";
import { parseThemeCssVariables, validateThemeIdInput } from "@/lib/vcard/theme-validator";
import { publishTheme } from "@/lib/vcard/theme-stream";
import { resolveProfileByUsernameOrId, toNullableString } from "@/lib/vcard/queries";
import {
  assertUserCanChangeOwnBizcardTheme,
  resolveCompanyThemePolicyForUser,
} from "@/server/lib/company";
import { AppError } from "@/lib/errors/types";
import { isThemeVisibleToUser } from "@/lib/services/theme-visibility.service";
import { resolveHitachiCompanyIds } from "@/lib/constants/hitachi-companies";

export interface ThemeSelectionInput {
  sessionUserId: bigint;
  themeId: bigint;
  previewOnly: boolean;
  alias?: string | null;
  now?: Date;
}

export interface ThemeSelectionResult {
  theme: {
    id: number;
    name: string;
    slug: string;
    config: Record<string, string>;
  };
  preview_url: string;
  applied_at: string;
  expires_at: string | null;
  persisted: boolean;
}

export class ThemeSelectionError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type ThemeSelectionDeps = {
  findUserById: (userId: bigint) => Promise<{
    user_id: bigint;
    custom_uri: string | null;
    serial_id: string | null;
    company_id: bigint | null;
  } | null>;
  resolveOwnerByAlias: (alias: string) => Promise<{ user_id: bigint } | null>;
  findThemeById: (themeId: bigint) => Promise<{
    id: bigint;
    theme_name: string;
    theme_path: string;
    css_variables: string | null;
    tag: string;
    price: { toString(): string } | number;
    is_active: boolean;
    exclusive_for: string | null;
  } | null>;
  hasThemePurchase: (userId: bigint, themeId: bigint) => Promise<boolean>;
  hasActiveSubscription: (userId: bigint) => Promise<boolean>;
  persistThemeSelection: (userId: bigint, themePath: string, now: Date) => Promise<void>;
  invalidateThemeCaches: (publicKey: string, userId: bigint) => void;
  publishThemeUpdate: (
    publicKey: string,
    payload: {
      theme_id: number;
      slug: string;
      preview_url: string;
      applied_at: string;
      name: string;
      config: Record<string, string>;
    }
  ) => void;
};

const defaultDeps: ThemeSelectionDeps = {
  findUserById: (userId) =>
    prisma.user.findUnique({
      where: { user_id: userId },
      select: {
        user_id: true,
        custom_uri: true,
        serial_id: true,
        company_id: true,
        role: true,
      },
    }),
  resolveOwnerByAlias: async (alias) => {
    const profile = await resolveProfileByUsernameOrId({ username: alias });
    if (!profile) return null;
    return { user_id: profile.user_id };
  },
  findThemeById: (themeId) =>
    prisma.theme.findUnique({
      where: { id: themeId },
      select: {
        id: true,
        theme_name: true,
        theme_path: true,
        css_variables: true,
        tag: true,
        price: true,
        is_active: true,
        exclusive_for: true,
      },
    }),
  hasThemePurchase: async (userId, themeId) => {
    const purchase = await prisma.templatePurchase.findUnique({
      where: {
        user_id_template_id: {
          user_id: userId,
          template_id: themeId,
        },
      },
      select: { id: true },
    });
    return Boolean(purchase);
  },
  // ─── FIXED: uses bizcardSubscription instead of userSubscription ──────────
  hasActiveSubscription: async (userId) => {
    const subscription = await prisma.bizcardSubscription.findFirst({
      where: {
        bizcard: { user_id: userId, deactivated_flag: false },
        status: "active",
      },
      select: { status: true, expires_at: true, cancelled_at: true },
    });
    if (!subscription) return false;
    return (
      subscription.status === "active" &&
      subscription.cancelled_at === null &&
      subscription.expires_at.getTime() > Date.now()
    );
  },
  persistThemeSelection: async (userId, themePath, now) => {
    await prisma.bizcard.updateMany({
      where: { user_id: userId },
      data: {
        bizcard_theme: themePath,
        updated_at: now,
      },
    });
  },
  invalidateThemeCaches: (publicKey, userId) => {
    cacheDelPrefix(`vcard:themes:owner:${userId.toString()}`);
    cacheDelPrefix("vcard:themes:public");
    cacheDelPrefix(`vcard:preview:${publicKey}:`);
    cacheDelPrefix(`vcard:design:${publicKey}`);
    void invalidateCache(generateCacheKey("public", "profile", publicKey.toLowerCase()));
  },
  publishThemeUpdate: (publicKey, payload) => {
    publishTheme(publicKey, {
      type: "theme_updated",
      data: {
        theme_id: payload.theme_id,
        slug: payload.slug,
        preview_url: payload.preview_url,
        applied_at: payload.applied_at,
      },
      theme: {
        id: String(payload.theme_id),
        name: payload.name,
        css_variables: payload.config,
        updated_at: payload.applied_at,
      },
    });
  },
};

export function parseThemeSelectionPayload(body: unknown): {
  themeId: bigint;
  previewOnly: boolean;
  alias: string | null;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ThemeSelectionError(400, "INVALID_REQUEST", "Invalid JSON body.");
  }

  const payload = body as Record<string, unknown>;
  const rawThemeId = payload.theme_id ?? payload.themeId;
  const themeId = validateThemeIdInput(rawThemeId);
  if (!themeId) {
    throw new ThemeSelectionError(
      422,
      "INVALID_THEME_ID",
      "theme_id must be a positive integer."
    );
  }

  const rawPreviewOnly = payload.preview_only ?? payload.previewOnly;
  if (rawPreviewOnly !== undefined && typeof rawPreviewOnly !== "boolean") {
    throw new ThemeSelectionError(
      422,
      "INVALID_PREVIEW_FLAG",
      "preview_only must be a boolean."
    );
  }

  const alias = toNullableString(payload.alias ?? payload.username);

  return {
    themeId,
    previewOnly: rawPreviewOnly === true,
    alias,
  };
}

function toThemeIdNumber(themeId: bigint): number {
  const asNumber = Number(themeId);
  if (!Number.isSafeInteger(asNumber) || asNumber <= 0) {
    throw new ThemeSelectionError(422, "INVALID_THEME_ID", "theme_id is out of supported range.");
  }
  return asNumber;
}

export async function applyVcardThemeSelection(
  input: ThemeSelectionInput,
  deps: ThemeSelectionDeps = defaultDeps
): Promise<ThemeSelectionResult> {
  const { sessionUserId, themeId, previewOnly } = input;
  const now = input.now ?? new Date();

  const user = await deps.findUserById(sessionUserId);
  if (!user) {
    throw new ThemeSelectionError(401, "UNAUTHORIZED", "Authentication required.");
  }

  if (input.alias) {
    const owner = await deps.resolveOwnerByAlias(input.alias.toLowerCase());
    if (!owner || owner.user_id !== user.user_id) {
      throw new ThemeSelectionError(401, "UNAUTHORIZED", "Authentication required.");
    }
  }

  const theme = await deps.findThemeById(themeId);
  if (!theme) {
    throw new ThemeSelectionError(404, "THEME_NOT_FOUND", "Theme ID does not exist.");
  }

  await resolveHitachiCompanyIds(prisma);
  const companyPolicy = await resolveCompanyThemePolicyForUser(user.user_id);

  const visibleToUser = isThemeVisibleToUser(
    theme.exclusive_for,
    user.user_id,
    companyPolicy.companyId ? BigInt(companyPolicy.companyId) : user.company_id,
  );

  if (!theme.is_active || !visibleToUser) {
    throw new ThemeSelectionError(
      403,
      "THEME_NOT_ACCESSIBLE",
      "Theme is not available for your account."
    );
  }

  const numericPrice = Number(theme.price ?? 0);
  const isPremium = theme.tag !== "free" || numericPrice > 0;

  if (isPremium && !previewOnly) {
    const hasPurchase = await deps.hasThemePurchase(user.user_id, theme.id);
    const hasSubscription = hasPurchase ? false : await deps.hasActiveSubscription(user.user_id);

    if (!hasPurchase && !hasSubscription) {
      throw new ThemeSelectionError(
        402,
        "PREMIUM_REQUIRED",
        "Purchase required to apply this theme."
      );
    }
  }

  const primaryBizcard = await prisma.bizcard.findFirst({
    where: { user_id: user.user_id, deactivated_flag: false },
    orderBy: [{ is_merged: "desc" }, { updated_at: "desc" }],
    select: { serial_id: true },
  });

  const publicKey = (
    user.custom_uri ??
    primaryBizcard?.serial_id ??
    user.serial_id ??
    `user-${user.user_id.toString()}`
  ).toLowerCase();
  const previewUrl = `/api/theme/preview?theme=${theme.id.toString()}`;
  const appliedAt = now.toISOString();
  const expiresAt = previewOnly ? new Date(now.getTime() + 5 * 60 * 1000).toISOString() : null;
  const config = parseThemeCssVariables(theme.css_variables);

  if (!previewOnly) {
    try {
      await assertUserCanChangeOwnBizcardTheme(sessionUserId, "vcard-theme-selection");
    } catch (error) {
      if (error instanceof AppError) {
        throw new ThemeSelectionError(error.statusCode, error.code, error.message);
      }
      throw error;
    }

    await deps.persistThemeSelection(user.user_id, theme.theme_path, now);
    deps.invalidateThemeCaches(publicKey, user.user_id);
    deps.publishThemeUpdate(publicKey, {
      theme_id: toThemeIdNumber(theme.id),
      slug: theme.theme_path,
      preview_url: previewUrl,
      applied_at: appliedAt,
      name: theme.theme_name,
      config,
    });
  }

  return {
    theme: {
      id: toThemeIdNumber(theme.id),
      name: theme.theme_name,
      slug: theme.theme_path,
      config,
    },
    preview_url: previewUrl,
    applied_at: appliedAt,
    expires_at: expiresAt,
    persisted: !previewOnly,
  };
}