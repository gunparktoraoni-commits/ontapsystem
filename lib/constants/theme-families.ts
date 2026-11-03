export interface ThemeFamilyDef {
  id: string;
  name: string;
  description: string;
  tier: 'basic' | 'standard' | 'premium' | 'enterprise';
  defaultThemeId: string;
  themeIds: string[];
}

const LEGACY_THEME_ALIASES: Record<string, string> = {
  "candy-flush": "rose-bloom",
  "fiery-sunset": "hibiscus-dusk",
  "snow-contrast": "jasmine-mist",
};

export function normalizeThemeId(themeId: string | null | undefined): string {
  const id = themeId ?? "";
  return LEGACY_THEME_ALIASES[id] ?? id;
}

export const THEME_FAMILIES: ThemeFamilyDef[] = [
  // BASIC TIER
  {
    id: "elegant-dark",
    name: "Elegant Dark",
    description: "Premium and refined for executive branding.",
    tier: "basic",
    defaultThemeId: "elegant-dark",
    themeIds: ["elegant-dark", "elegant-dark-v2", "elegant-dark-v3"],
  },
  {
    id: "basic/modern-minimalist",
    name: "Modern Minimalist",
    description: "Minimal compositions with modern contrast and polished geometry.",
    tier: "basic",
    defaultThemeId: "charcoal-yellow",
    themeIds: ["charcoal-yellow", "ocean-blue", "light-blue"],
  },
  {
    id: "basic/simple-classico",
    name: "Simple Classico",
    description: "Clean and balanced editorial styling with warm classic accents.",
    tier: "basic",
    defaultThemeId: "green-gold",
    themeIds: ["green-gold", "blue-red", "hot-orange"],
  },

  // STANDARD TIER
  {
    id: "standard/ocean-gradient",
    name: "Ocean Gradient",
    description: "Fresh and modern with clean visual depth.",
    tier: "standard",
    defaultThemeId: "ocean-gradient",
    themeIds: ["ocean-gradient", "ocean-gradient-v2", "ocean-gradient-v3"],
  },
  {
    id: "standard/og-neumorphic",
    name: "OG Neumorphic",
    description: "Soft neo-neumorphic surfaces with atmospheric depth.",
    tier: "standard",
    defaultThemeId: "ice-variant",
    themeIds: ["ice-variant", "warm-pastel", "midnight-moon"],
  },
  {
    id: "standard/premium-gotham",
    name: "Premium Gotham",
    description: "High-contrast Gotham-inspired layouts with sharp premium moods.",
    tier: "standard",
    defaultThemeId: "carbon-diamond",
    themeIds: ["carbon-diamond", "void-purple", "timeless-gold"],
  },
  {
    id: "standard/royal-purple",
    name: "Royal Purple",
    description: "Bold and expressive for standout portfolios.",
    tier: "standard",
    defaultThemeId: "royal-purple",
    themeIds: ["royal-purple", "royal-purple-v2", "royal-purple-v3"],
  },

  // PREMIUM TIER
  {
    id: "premium/floral-madness",
    name: "Floral Madness",
    description: "Playful frosted glass composition with floral color-wave energy.",
    tier: "premium",
    defaultThemeId: "rose-bloom",
    themeIds: ["rose-bloom", "hibiscus-dusk", "jasmine-mist"],
  },
  {
    id: "paidthemes/bubble-gem",
    name: "BubbleGem",
    description: "Deep indigo mesh aura with frosted bubble glass and dual-type polish.",
    tier: "premium",
    defaultThemeId: "bubble-gem",
    themeIds: ["bubble-gem"],
  },
  {
    id: "paidthemes/frosted-crystal",
    name: "Frosted Crystal",
    description: "Dark Vision Pro glass with cyan luminous accents and floating crystal panels.",
    tier: "premium",
    defaultThemeId: "frosted-crystal",
    themeIds: ["frosted-crystal"],
  },
  {
    id: "paidthemes/dark-cinematic",
    name: "Velvet Noir",
    description: "Dark cinematic glass with electric lime accents and olive-black atmosphere.",
    tier: "premium",
    defaultThemeId: "dark-cinematic",
    themeIds: ["dark-cinematic"],
  },
  {
    id: "premium/luxurious-editorial",
    name: "Luxurious Editorial",
    description: "Editorial layouts with premium textures and timeless contrast.",
    tier: "premium",
    defaultThemeId: "classic-gold",
    themeIds: ["classic-gold", "ocean-blue-gold", "violet-pink"],
  },
  {
    id: "premium/nouveau-riche",
    name: "Nouveau Riche",
    description: "Opulent gold-forward layouts with rich jewel-toned accents.",
    tier: "premium",
    defaultThemeId: "pristine-gold",
    themeIds: ["pristine-gold", "blood-rose", "minty-green"],
  },

  // ENTERPRISE TIER
  {
    id: "enterprise/hitachi-solutions",
    name: "Hitachi Solutions",
    description: "Corporate Hitachi branding with red header and structured contact layout.",
    tier: "enterprise",
    defaultThemeId: "hitachi-solutions",
    themeIds: ["hitachi-solutions"],
  },
];

export type SubscriptionThemeTier = "basic" | "standard" | "premium" | "enterprise" | "free";

const TIER_RANK: Record<SubscriptionThemeTier, number> = {
  free: 0,
  basic: 1,
  standard: 2,
  premium: 3,
  enterprise: 3,
};

export function normalizeThemeTier(raw: string | null | undefined): SubscriptionThemeTier {
  const lowered = String(raw ?? "").trim().toLowerCase();
  if (lowered === "premium" || lowered === "enterprise") return lowered === "enterprise" ? "enterprise" : "premium";
  if (lowered === "standard") return "standard";
  if (lowered === "basic") return "basic";
  return "free";
}

export function getThemeTierRank(tier: SubscriptionThemeTier): number {
  return TIER_RANK[tier] ?? 0;
}

export function isThemeFamilyAvailableForTier(familyId: string, tier: SubscriptionThemeTier): boolean {
  if (
    familyId === "elegant-dark" ||
    familyId === "ocean-gradient" ||
    familyId === "royal-purple"
  ) {
    return true;
  }
  const rank = getThemeTierRank(tier);
  if (familyId.startsWith("basic/")) return rank >= 1;
  if (familyId.startsWith("standard/")) return rank >= 2;
  if (familyId.startsWith("premium/")) return rank >= 3;
  if (familyId.startsWith("paidthemes/")) return rank >= 3;
  if (familyId.startsWith("enterprise/")) return rank >= 2;
  return true;
}

export function getAvailableThemeFamilies(tier: SubscriptionThemeTier): ThemeFamilyDef[] {
  return THEME_FAMILIES.filter((family) => isThemeFamilyAvailableForTier(family.id, tier));
}

export function getThemeFamily(themeId?: string): ThemeFamilyDef {
  const normalizedThemeId = normalizeThemeId(themeId);
  return THEME_FAMILIES.find((family) => family.themeIds.includes(normalizedThemeId)) ?? THEME_FAMILIES[0];
}

export function getThemeFamilyById(familyId?: string): ThemeFamilyDef {
  return THEME_FAMILIES.find((family) => family.id === familyId) ?? THEME_FAMILIES[0];
}

export function prioritizeSelectedThemeIds(
  themeIds: readonly string[],
  selectedThemeId: string | null | undefined,
): string[] {
  if (!selectedThemeId) return [...themeIds];
  const normalizedThemeId = normalizeThemeId(selectedThemeId);
  const selectedIndex = themeIds.indexOf(normalizedThemeId);
  if (selectedIndex <= 0) return [...themeIds];
  return [themeIds[selectedIndex], ...themeIds.slice(0, selectedIndex), ...themeIds.slice(selectedIndex + 1)];
}

export function prioritizeSelectedThemeFamily(
  families: readonly ThemeFamilyDef[],
  selectedThemeId: string | null | undefined,
): ThemeFamilyDef[] {
  if (!selectedThemeId) return [...families];
  const normalizedThemeId = normalizeThemeId(selectedThemeId);
  const selectedIndex = families.findIndex((family) => family.themeIds.includes(normalizedThemeId));
  if (selectedIndex <= 0) return [...families];
  return [families[selectedIndex], ...families.slice(0, selectedIndex), ...families.slice(selectedIndex + 1)];
}

export function resolveThemeIdFromCompanyTheme(companyTheme: string | null | undefined): string {
  const trimmed = String(companyTheme ?? "default").trim();
  if (!trimmed || trimmed === "default") return "elegant-dark";
  const normalizedThemeId = normalizeThemeId(trimmed);
  const byThemeId = THEME_FAMILIES.find((family) => family.themeIds.includes(normalizedThemeId));
  if (byThemeId) return normalizedThemeId;
  const byFamilyId = THEME_FAMILIES.find((family) => family.id === normalizedThemeId);
  if (byFamilyId) return byFamilyId.defaultThemeId;
  return normalizedThemeId;
}

export function isValidCompanyThemeId(themeId: string): boolean {
  const trimmed = themeId.trim();
  if (!trimmed || trimmed.length > 100) return false;
  const normalizedThemeId = normalizeThemeId(trimmed);
  return THEME_FAMILIES.some(
    (family) =>
      family.id === normalizedThemeId ||
      family.themeIds.includes(normalizedThemeId) ||
      family.defaultThemeId === normalizedThemeId,
  );
}
