// lib/backend/services/theme.service.ts
import { randomUUID, createHash } from "node:crypto";
import { prisma } from "@/server/lib/prisma";
import { CACHE_TTL, generateCacheKey, getCached, invalidateCache, setCache } from "@/lib/cache";
import { AppError, ErrorCode, createNotFoundError } from "@/lib/errors/types";
import { resolveHitachiCompanyIds } from "@/lib/constants/hitachi-companies";
import { isThemeVisibleToUser } from "@/lib/services/theme-visibility.service";
import { resolveCompanyThemePolicyForUser } from "@/server/lib/company";

type CssVariables = Record<string, string>;

export interface ThemeWithColorWays {
  theme_id: number;
  name: string;
  slug: string;
  description: string | null;
  preview_image: string | null;
  thumbnail: string | null;
  is_premium: boolean;
  price: number | null;
  color_ways: Array<{
    color_way_id: number;
    name: string;
    description: string | null;
    css_variables: CssVariables;
    gradient_start: string | null;
    gradient_end: string | null;
    is_default: boolean;
  }>;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCssVariables(value: unknown): CssVariables {
  if (!isObjectRecord(value)) return {};
  const out: CssVariables = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") out[key] = raw;
    else if (typeof raw === "number" || typeof raw === "boolean") out[key] = String(raw);
  }
  return out;
}

function parseCssVariables(value: string | null): CssVariables {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return normalizeCssVariables(parsed);
  } catch {
    return {};
  }
}

function mapTheme(theme: {
  id: bigint;
  theme_name: string;
  theme_path: string;
  preview_image: string | null;
  category: string | null;
  css_variables: string | null;
  price: { toString(): string } | number;
  tag: string;
}): ThemeWithColorWays {
  const numericPrice = Number(theme.price ?? 0);
  const cssVariables = parseCssVariables(theme.css_variables);
  return {
    theme_id: Number(theme.id),
    name: theme.theme_name,
    slug: theme.theme_path,
    description: theme.category,
    preview_image: theme.preview_image,
    thumbnail: theme.preview_image,
    is_premium: theme.tag !== "free" || numericPrice > 0,
    price: Number.isFinite(numericPrice) ? numericPrice : null,
    color_ways: [
      {
        color_way_id: 1,
        name: "Default",
        description: null,
        css_variables: cssVariables,
        gradient_start: null,
        gradient_end: null,
        is_default: true,
      },
    ],
  };
}

export class ThemeService {
  private readonly requestId: string;

  constructor(requestId?: string) {
    this.requestId = requestId ?? randomUUID();
  }

  async getAllThemes(): Promise<ThemeWithColorWays[]> {
    const cacheKey = generateCacheKey("themes", "all", "active");
    const { data } = await getCached(
      cacheKey,
      async () => {
        const themes = await prisma.theme.findMany({
          where: { is_active: true },
          orderBy: [{ created_at: "desc" }],
        });

        if (!themes.length) {
          throw new AppError(ErrorCode.THEME_NOT_FOUND, "No active themes found", 404, {}, this.requestId);
        }

        return themes.map(mapTheme);
      },
      CACHE_TTL.THEMES_LIST
    );

    return data;
  }

  async getThemeById(themeId: number): Promise<ThemeWithColorWays> {
    const cacheKey = generateCacheKey("themes", "detail", themeId);
    const { data } = await getCached(
      cacheKey,
      async () => {
        const theme = await prisma.theme.findFirst({
          where: { id: BigInt(themeId), is_active: true },
        });

        if (!theme) {
          throw createNotFoundError("Theme", themeId, this.requestId);
        }

        return mapTheme(theme);
      },
      CACHE_TTL.THEME_DETAIL
    );

    return data;
  }

  async getColorWayById(colorWayId: number) {
    const cacheKey = generateCacheKey("themes", "color-way", colorWayId);
    const { data } = await getCached(
      cacheKey,
      async () => {
        if (colorWayId !== 1) {
          throw new AppError(
            ErrorCode.COLOR_WAY_NOT_FOUND,
            `Color way with ID ${colorWayId} not found`,
            404,
            { colorWayId },
            this.requestId
          );
        }

        const theme = await prisma.theme.findFirst({
          where: { is_active: true },
          orderBy: { created_at: "desc" },
        });

        if (!theme) {
          throw new AppError(ErrorCode.THEME_NOT_FOUND, "No active themes found", 404, {}, this.requestId);
        }

        return {
          color_way_id: 1,
          name: "Default",
          description: null,
          css_variables: parseCssVariables(theme.css_variables),
          gradient_start: null,
          gradient_end: null,
          is_default: true,
          theme: {
            theme_id: Number(theme.id),
            name: theme.theme_name,
            slug: theme.theme_path,
            is_premium: theme.tag !== "free" || Number(theme.price ?? 0) > 0,
          },
        };
      },
      CACHE_TTL.COLOR_WAY
    );

    return data;
  }

  async getUserThemeSelection(bizcardId: number, userId?: string) {
    const ownerId = userId ? BigInt(userId) : undefined;

    const bizcard = await prisma.bizcard.findUnique({
      where: { bizcard_id: BigInt(bizcardId) },
      select: { bizcard_id: true, user_id: true, bizcard_theme: true, updated_at: true, created_at: true },
    });

    if (!bizcard) return null;

    if (ownerId && bizcard.user_id !== ownerId) {
      throw new AppError(
        ErrorCode.SELECTION_PERMISSION_DENIED,
        `Permission denied for bizcard ${bizcardId}`,
        403,
        { bizcardId, userId },
        this.requestId
      );
    }

    if (!bizcard.bizcard_theme) return null;

    const theme = await prisma.theme.findUnique({
      where: { theme_path: bizcard.bizcard_theme },
      select: { id: true, theme_name: true, theme_path: true, css_variables: true, tag: true, price: true },
    });

    if (!theme) return null;

    return {
      selection_id: Number(bizcard.bizcard_id),
      theme: {
        theme_id: Number(theme.id),
        name: theme.theme_name,
        slug: theme.theme_path,
        is_premium: theme.tag !== "free" || Number(theme.price ?? 0) > 0,
      },
      color_way: {
        color_way_id: 1,
        name: "Default",
        css_variables: parseCssVariables(theme.css_variables),
      },
      selected_at: bizcard.updated_at ?? bizcard.created_at,
    };
  }

  async saveThemeSelection(bizcardId: number, themeId: number, colorWayId: number, userId: string): Promise<void> {
    const ownerId = BigInt(userId);

    const bizcard = await prisma.bizcard.findFirst({
      where: {
        bizcard_id: BigInt(bizcardId),
        user_id: ownerId,
      },
      select: { bizcard_id: true },
    });

    if (!bizcard) {
      throw new AppError(
        ErrorCode.BIZCARD_NOT_FOUND,
        `Bizcard ${bizcardId} not found or does not belong to user`,
        404,
        { bizcardId, userId },
        this.requestId
      );
    }

    const theme = await prisma.theme.findFirst({
      where: { id: BigInt(themeId), is_active: true },
      select: { id: true, theme_name: true, tag: true, price: true, theme_path: true, exclusive_for: true },
    });

    if (!theme) {
      throw createNotFoundError("Theme", themeId, this.requestId);
    }
    await this.assertThemeVisibleToUser(theme.exclusive_for, ownerId, this.requestId);

    if (colorWayId !== 1) {
      throw new AppError(
        ErrorCode.COLOR_WAY_NOT_FOUND,
        `Color way ${colorWayId} not found for theme ${themeId}`,
        404,
        { colorWayId, themeId },
        this.requestId
      );
    }

    const premiumRequired = theme.tag !== "free" || Number(theme.price ?? 0) > 0;
    if (premiumRequired) {
      const hasPremium = await this.checkPremiumAccess(ownerId, BigInt(themeId));
      if (!hasPremium) {
        throw new AppError(
          ErrorCode.THEME_PREMIUM_REQUIRED,
          `Theme '${theme.theme_name}' requires premium subscription or purchase`,
          403,
          { themeId, themeName: theme.theme_name },
          this.requestId
        );
      }
    }

    await prisma.bizcard.update({
      where: { bizcard_id: BigInt(bizcardId) },
      data: { bizcard_theme: theme.theme_path, updated_at: new Date() },
    });

    await invalidateCache(generateCacheKey("themes", "all", "active"));
    await invalidateCache(generateCacheKey("themes", "detail", themeId));
    await invalidateCache(generateCacheKey("bizcard-theme", bizcardId));
  }

  async createPreviewSession(
    bizcardId: number,
    themeId: number,
    colorWayId: number,
    userId: string
  ): Promise<{ previewToken: string; cssVariables: CssVariables }> {
    const ownerId = BigInt(userId);

    const bizcard = await prisma.bizcard.findFirst({
      where: {
        bizcard_id: BigInt(bizcardId),
        user_id: ownerId,
      },
      select: { bizcard_id: true },
    });

    if (!bizcard) {
      throw new AppError(ErrorCode.BIZCARD_NOT_FOUND, `Bizcard ${bizcardId} not found`, 404, { bizcardId }, this.requestId);
    }

    const theme = await prisma.theme.findFirst({
      where: {
        id: BigInt(themeId),
        is_active: true,
      },
      select: { css_variables: true, exclusive_for: true },
    });

    if (!theme || colorWayId !== 1) {
      throw new AppError(ErrorCode.COLOR_WAY_NOT_FOUND, "Color way not found", 404, { colorWayId, themeId }, this.requestId);
    }
    await this.assertThemeVisibleToUser(theme.exclusive_for, ownerId, this.requestId);

    const previewToken = this.generatePreviewToken(bizcardId, themeId, colorWayId);
    const cssVariables = parseCssVariables(theme.css_variables);

    await setCache(generateCacheKey("preview", previewToken), {
      bizcardId,
      themeId,
      colorWayId,
      cssVariables,
    }, 900);

    return { previewToken, cssVariables };
  }

  private async assertThemeVisibleToUser(
    exclusiveFor: string | null,
    userId: bigint,
    requestId: string,
  ): Promise<void> {
    await resolveHitachiCompanyIds(prisma);
    const companyPolicy = await resolveCompanyThemePolicyForUser(userId);
    const companyId = companyPolicy.companyId ? BigInt(companyPolicy.companyId) : null;
    if (!isThemeVisibleToUser(exclusiveFor, userId, companyId)) {
      throw createNotFoundError("Theme", "unavailable", requestId);
    }
  }

  async trackThemeView(_themeId: number, _colorWayId: number): Promise<void> {
    try {
      // Intentionally no-op: normalized schema does not include theme analytics tables.
    } catch {
      // Intentionally non-fatal.
    }
  }

  async getThemeAnalytics(themeId?: number) {
    const themes = await prisma.theme.findMany({
      where: {
        ...(themeId ? { id: BigInt(themeId) } : {}),
      },
      select: {
        id: true,
        theme_name: true,
        theme_path: true,
        updated_at: true,
      },
    });

    const usageCounts = await prisma.bizcard.groupBy({
      by: ["bizcard_theme"],
      where: {
        bizcard_theme: {
          in: themes.map((t) => t.theme_path),
        },
      },
      _count: { _all: true },
    });

    const countByPath = new Map<string, number>();
    for (const row of usageCounts) {
      if (row.bizcard_theme) {
        countByPath.set(row.bizcard_theme, row._count._all);
      }
    }

    const details = themes.map((row) => ({
      analytics_id: Number(row.id) * 1000 + 1,
      theme_id: Number(row.id),
      color_way_id: 1,
      view_count: 0,
      selection_count: countByPath.get(row.theme_path) ?? 0,
      preview_count: 0,
      last_used: row.updated_at,
      theme: {
        theme_id: Number(row.id),
        name: row.theme_name,
        slug: row.theme_path,
      },
      color_way: {
        color_way_id: 1,
        name: "Default",
      },
    })).sort((a, b) => b.selection_count - a.selection_count);

    const summary = {
      total_views: details.reduce((sum, item) => sum + item.view_count, 0),
      total_selections: details.reduce((sum, item) => sum + item.selection_count, 0),
      total_previews: details.reduce((sum, item) => sum + item.preview_count, 0),
      top_themes: details.slice(0, 10).map((item) => ({
        theme_id: item.theme.theme_id,
        theme_name: item.theme.name,
        selections: item.selection_count,
        views: item.view_count,
      })),
    };

    return { details, summary };
  }

  private generatePreviewToken(bizcardId: number, themeId: number, colorWayId: number): string {
    const timestamp = Date.now();
    const data = `${bizcardId}:${themeId}:${colorWayId}:${timestamp}:${this.requestId}`;
    return createHash("sha256").update(data).digest("hex");
  }

  // ─── FIXED: uses bizcardSubscription instead of userSubscription ──────────
  private async checkPremiumAccess(userId: bigint, themeId: bigint): Promise<boolean> {
    const purchase = await prisma.templatePurchase.findUnique({
      where: {
        user_id_template_id: {
          user_id: userId,
          template_id: themeId,
        },
      },
      select: { id: true },
    });

    if (purchase) return true;

    // Check if user has any active subscription on any of their bizcards
    const subscription = await prisma.bizcardSubscription.findFirst({
      where: {
        bizcard: { user_id: userId, deactivated_flag: false },
        status: "active",
      },
      select: { status: true, expires_at: true, cancelled_at: true },
    });

    if (!subscription) return false;

    const active = subscription.status === "active";
    const notCancelled = subscription.cancelled_at === null;
    const notExpired = subscription.expires_at.getTime() > Date.now();
    return active && notCancelled && notExpired;
  }
}