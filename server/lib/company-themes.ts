import { prisma } from "@/server/lib/prisma";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";
import {
  getAvailableThemeFamilies,
  getThemeFamily,
  isThemeFamilyAvailableForTier,
  isValidCompanyThemeId,
  normalizeThemeTier,
  prioritizeSelectedThemeFamily,
  resolveThemeIdFromCompanyTheme,
  type SubscriptionThemeTier,
  type ThemeFamilyDef,
} from "@/lib/constants/theme-families";
import { HITACHI_THEME_FAMILY_ID, isHitachiCompanyName } from "@/lib/constants/hitachi-companies";

const TIER_RANK: Record<SubscriptionThemeTier, number> = {
  free: 0,
  basic: 1,
  standard: 2,
  premium: 3,
  enterprise: 3,
};

function normalizeSubscriptionTier(raw: string | null | undefined): SubscriptionThemeTier {
  const lowered = String(raw ?? "").trim().toLowerCase();
  if (lowered === "enterprise") return "enterprise";
  if (lowered === "premium") return "premium";
  if (lowered === "standard") return "standard";
  if (lowered === "basic") return "basic";
  return "free";
}

function pickHighestTier(tiers: SubscriptionThemeTier[]): SubscriptionThemeTier {
  return tiers.sort((a, b) => (TIER_RANK[b] ?? 0) - (TIER_RANK[a] ?? 0))[0] ?? "free";
}

export async function getPrimaryAdminUserId(companyId: bigint): Promise<bigint | null> {
  const company = await prisma.company.findUnique({
    where: { company_id: companyId },
    select: { admin_id: true, created_by: true },
  });
  if (!company) return null;
  return company.admin_id ?? company.created_by ?? null;
}

export async function getPrimaryAdminSubscriptionTier(companyId: bigint): Promise<SubscriptionThemeTier> {
  const adminUserId = await getPrimaryAdminUserId(companyId);
  if (!adminUserId) return "free";

  const now = new Date();
  const bizcards = await prisma.bizcard.findMany({
    where: {
      user_id: adminUserId,
      deactivated_flag: false,
      subscription_status: "active",
      subscription_expires_at: { gt: now },
    },
    select: { subscription_tier: true },
  });

  if (!bizcards.length) return "free";

  const tiers = bizcards.map((card) => normalizeSubscriptionTier(card.subscription_tier));
  return pickHighestTier(tiers);
}

export function getAvailableCompanyThemes(
  tier: SubscriptionThemeTier,
  companyName?: string | null,
  selectedThemeId?: string | null,
): ThemeFamilyDef[] {
  const isHitachiCompany = isHitachiCompanyName(companyName ?? "");
  return prioritizeSelectedThemeFamily(
    getAvailableThemeFamilies(tier).filter(
      (family) => family.id !== HITACHI_THEME_FAMILY_ID || isHitachiCompany,
    ),
    selectedThemeId,
  );
}

export function assertThemeAllowedForTier(
  themeId: string,
  tier: SubscriptionThemeTier,
  requestId: string,
  isHitachiCompany = false,
): string {
  const resolved = resolveThemeIdFromCompanyTheme(themeId);

  if (!isValidCompanyThemeId(resolved)) {
    throw createCompanyError(
      CompanyErrorCode.INVALID_COMPANY_THEME,
      "Invalid company theme selection.",
      422,
      requestId,
      { themeId: resolved },
    );
  }

  const family = getThemeFamily(resolved);
  if (family.id === HITACHI_THEME_FAMILY_ID && !isHitachiCompany) {
    throw createCompanyError(
      CompanyErrorCode.INVALID_COMPANY_THEME,
      "The Hitachi Solutions theme is available only to Hitachi companies.",
      403,
      requestId,
      { themeId: resolved },
    );
  }
  if (!isThemeFamilyAvailableForTier(family.id, tier)) {
    throw createCompanyError(
      CompanyErrorCode.INVALID_COMPANY_THEME,
      "This theme requires a higher subscription tier from the primary company administrator.",
      403,
      requestId,
      { themeId: resolved, requiredTier: family.id.split("/")[0], currentTier: normalizeThemeTier(tier) },
    );
  }

  return resolved;
}

export async function getCompanyThemeContext(companyId: bigint): Promise<{
  company_theme: string | null;
  current_theme_id: string;
  subscription_tier: SubscriptionThemeTier;
  available_themes: ThemeFamilyDef[];
}> {
  const [company, tier] = await Promise.all([
    prisma.company.findUnique({
      where: { company_id: companyId },
      select: { company_theme: true, name: true },
    }),
    getPrimaryAdminSubscriptionTier(companyId),
  ]);

  const companyTheme = company?.company_theme ?? "default";
  const currentThemeId = resolveThemeIdFromCompanyTheme(companyTheme);

  return {
    company_theme: companyTheme,
    current_theme_id: currentThemeId,
    subscription_tier: tier,
    available_themes: getAvailableCompanyThemes(tier, company?.name, currentThemeId),
  };
}
