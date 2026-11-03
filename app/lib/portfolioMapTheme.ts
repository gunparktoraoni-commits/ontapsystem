/**
 * Derive Leaflet map colorization from portfolio theme tokens.
 * Keeps roads/labels readable while shifting the palette toward the template accent.
 */

export type PortfolioMapThemeInput = {
  accent?: string;
  cardBg?: string;
  text?: string;
  textMuted?: string;
  glass?: string;
};

export type PortfolioMapVisualStyle = {
  isDark: boolean;
  tileFilter: string;
  overlayGradient: string;
  containerBg: string;
  markerFill: string;
  markerRing: string;
  markerGlow: string;
  frameBorder: string;
  frameGlow: string;
};

type Rgb = { r: number; g: number; b: number };

function clamp(n: number, min = 0, max = 255): number {
  return Math.min(max, Math.max(min, n));
}

function parseCssColor(input?: string): Rgb | null {
  if (!input) return null;
  const value = input.trim();

  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length === 8) h = h.slice(0, 6);
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  const rgba = value.match(
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i,
  );
  if (rgba) {
    return {
      r: clamp(Number(rgba[1])),
      g: clamp(Number(rgba[2])),
      b: clamp(Number(rgba[3])),
    };
  }

  return null;
}

function luminance({ r, g, b }: Rgb): number {
  const toLin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

/** CSS hue-rotate degrees for an RGB color (0–360). */
function rgbToHue({ r, g, b }: Rgb): number {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  if (d === 0) return 0;
  let h = 0;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b]
    .map((c) => clamp(Math.round(c)).toString(16).padStart(2, '0'))
    .join('')}`;
}

function withAlpha(rgb: Rgb, alpha: number): string {
  return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${alpha})`;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

const FALLBACK_ACCENT: Rgb = { r: 42, g: 71, b: 146 };
const FALLBACK_DARK_BG: Rgb = { r: 15, g: 18, b: 28 };
const FALLBACK_LIGHT_BG: Rgb = { r: 246, g: 248, b: 252 };

/**
 * Build map visual tokens from portfolio theme colors.
 * Sepia baseline sits near ~35–40°; we hue-rotate from there toward the accent.
 */
export function buildPortfolioMapVisualStyle(
  theme?: PortfolioMapThemeInput | null,
): PortfolioMapVisualStyle {
  const accent = parseCssColor(theme?.accent) ?? FALLBACK_ACCENT;
  const cardBg = parseCssColor(theme?.cardBg);
  const text = parseCssColor(theme?.text);

  // Prefer card/surface luminance; fall back to text (light text ⇒ dark theme).
  let isDark = true;
  if (cardBg && luminance(cardBg) > 0.02) {
    isDark = luminance(cardBg) < 0.42;
  } else if (text) {
    isDark = luminance(text) > 0.55;
  }

  const accentHue = rgbToHue(accent);
  // Sepia filter's effective hue ~35°
  const hueRotate = Math.round(accentHue - 35);

  const tileFilter = isDark
    ? [
        'grayscale(1)',
        'invert(1)',
        'contrast(0.92)',
        'brightness(0.72)',
        'sepia(0.62)',
        `hue-rotate(${hueRotate}deg)`,
        'saturate(1.15)',
        'brightness(0.92)',
      ].join(' ')
    : [
        'grayscale(0.28)',
        'contrast(1.06)',
        'brightness(1.03)',
        'sepia(0.42)',
        `hue-rotate(${hueRotate}deg)`,
        'saturate(0.95)',
      ].join(' ');

  const surface = cardBg ?? (isDark ? FALLBACK_DARK_BG : FALLBACK_LIGHT_BG);
  const softAccent = mix(accent, surface, isDark ? 0.35 : 0.55);
  const deepAccent = mix(accent, isDark ? FALLBACK_DARK_BG : { r: 20, g: 24, b: 40 }, 0.25);

  const overlayGradient = isDark
    ? `linear-gradient(165deg, ${withAlpha(accent, 0.28)} 0%, ${withAlpha(softAccent, 0.12)} 42%, ${withAlpha(deepAccent, 0.34)} 100%)`
    : `linear-gradient(165deg, ${withAlpha(accent, 0.18)} 0%, ${withAlpha(softAccent, 0.08)} 48%, ${withAlpha(accent, 0.16)} 100%)`;

  const markerFill = toHex(accent);
  const markerRing = isDark ? withAlpha({ r: 255, g: 255, b: 255 }, 0.92) : withAlpha(surface, 0.95);
  const markerGlow = withAlpha(accent, isDark ? 0.55 : 0.4);
  const frameBorder = withAlpha(accent, isDark ? 0.35 : 0.28);
  const frameGlow = `0 0 0 1px ${withAlpha(accent, 0.18)}, 0 12px 36px ${withAlpha(accent, isDark ? 0.22 : 0.14)}`;

  return {
    isDark,
    tileFilter,
    overlayGradient,
    containerBg: toHex(surface),
    markerFill,
    markerRing,
    markerGlow,
    frameBorder,
    frameGlow,
  };
}
