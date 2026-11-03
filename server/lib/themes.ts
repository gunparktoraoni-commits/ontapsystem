import { stat } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_THEME_PATH = "ocean-gradient";

const THEME_PATH_REGEX = /^[a-z0-9][a-z0-9-]{1,63}$/;
const THEMES_ROOT = path.join(process.cwd(), "app", "themes");

/** Portfolio theme slugs used by ThemeLoader (variant ids + family keys). */
export const KNOWN_PORTFOLIO_THEME_SLUGS = new Set<string>([
  "basic/simple-classico",
  "basic/modern-minimalist",
  "premium/luxurious-editorial",
  "premium/nouveau-riche",
  "premium/og-neumorphic",
  "standard/bubble-glass",
  "standard/premium-gotham",
  "elegant-dark",
  "elegant-dark-v2",
  "elegant-dark-v3",
  "ocean-gradient",
  "ocean-gradient-v2",
  "ocean-gradient-v3",
  "royal-purple",
  "royal-purple-v2",
  "royal-purple-v3",
  "green-gold",
  "blue-red",
  "hot-orange",
  "charcoal-yellow",
  "ocean-blue",
  "light-blue",
  "carbon-diamond",
  "void-purple",
  "timeless-gold",
  "candy-flush",
  "snow-contrast",
  "fiery-sunset",
  "classic-gold",
  "ocean-blue-gold",
  "violet-pink",
  "pristine-gold",
  "blood-rose",
  "minty-green",
  "ice-variant",
  "warm-pastel",
  "midnight-moon",
  "hitachi-solutions",
  // Floral-madness canonical theme names (also known by legacy names above)
  "rose-bloom",
  "jasmine-mist",
  "hibiscus-dusk",
  // Paid marketplace templates
  "bubble-gem",
  "frosted-crystal",
  "dark-cinematic",
]);

export function isKnownPortfolioThemeSlug(themePath: string): boolean {
  const normalized = normalizeThemePath(themePath);
  if (!normalized) return false;
  return KNOWN_PORTFOLIO_THEME_SLUGS.has(normalized);
}

export function normalizeThemePath(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed || !THEME_PATH_REGEX.test(trimmed)) return null;
  return trimmed;
}

export function buildThemeFsPath(themePath: string): string {
  return path.join(THEMES_ROOT, themePath);
}

export async function isThemeAvailable(themePath: string): Promise<boolean> {
  const normalized = normalizeThemePath(themePath);
  if (!normalized) return false;

  try {
    const info = await stat(buildThemeFsPath(normalized));
    return info.isDirectory();
  } catch {
    return false;
  }
}

// Backward-compatible export name used by existing routes.
export async function resolveThemeSlug(input: unknown): Promise<string> {
  const normalized = normalizeThemePath(input);
  if (!normalized) return DEFAULT_THEME_PATH;
  if (await isThemeAvailable(normalized)) return normalized;
  return DEFAULT_THEME_PATH;
}

export async function validateThemePathForWrite(input: unknown): Promise<string | null> {
  const normalized = normalizeThemePath(input);
  if (!normalized) return null;
  if (isKnownPortfolioThemeSlug(normalized)) return normalized;
  if (await isThemeAvailable(normalized)) return normalized;
  return null;
}
