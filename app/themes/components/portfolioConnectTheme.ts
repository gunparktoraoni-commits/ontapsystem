import type { PortfolioSocialProofTheme } from "./PortfolioSocialProof";

const LEGACY_THEME_ID_MAP: Record<string, string> = {
  "1": "elegant-dark",
  "2": "ocean-gradient",
  "3": "royal-purple",
  "candy-flush": "rose-bloom",
  "fiery-sunset": "hibiscus-dusk",
  "snow-contrast": "jasmine-mist",
};

function normalizeThemeId(value?: string | null): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (LEGACY_THEME_ID_MAP[raw]) return LEGACY_THEME_ID_MAP[raw];
  const slug = raw.replace(/\s+/g, "-");
  if (slug.includes("/")) return slug.split("/").pop() || slug;
  return slug;
}

export type PortfolioConnectTheme = PortfolioSocialProofTheme & {
  overlay: string;
  onAccent: string;
  mode: "light" | "dark";
};

type ThemeSeed = Omit<PortfolioConnectTheme, "onAccent" | "mode" | "overlay"> & {
  overlay?: string;
  onAccent?: string;
  mode?: "light" | "dark";
};

function parseRgb(color: string): { r: number; g: number; b: number } | null {
  const value = color.trim();
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1];
    const full =
      raw.length === 3
        ? raw
            .split("")
            .map((c) => c + c)
            .join("")
        : raw;
    return {
      r: Number.parseInt(full.slice(0, 2), 16),
      g: Number.parseInt(full.slice(2, 4), 16),
      b: Number.parseInt(full.slice(4, 6), 16),
    };
  }
  const rgb = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgb) return null;
  return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
}

function relativeLuma(color: string): number {
  const rgb = parseRgb(color);
  if (!rgb) return 0.2;
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
}

function contrastOn(color: string): string {
  return relativeLuma(color) > 0.62 ? "#111318" : "#ffffff";
}

function detectMode(surface: string, text: string): "light" | "dark" {
  if (relativeLuma(text) > 0.55) return "dark";
  if (relativeLuma(surface) > 0.72) return "light";
  return "dark";
}

function hydrate(seed: ThemeSeed): PortfolioConnectTheme {
  const mode = seed.mode ?? detectMode(seed.surface, seed.text);
  return {
    ...seed,
    mode,
    overlay: seed.overlay ?? (mode === "dark" ? "rgba(4,6,12,0.62)" : "rgba(15,23,42,0.38)"),
    onAccent: seed.onAccent ?? contrastOn(seed.accent),
  };
}

const DEFAULT_THEME = hydrate({
  surface: "#ffffff",
  border: "rgba(15,23,42,0.1)",
  text: "#0f172a",
  muted: "#64748b",
  accent: "#2A4792",
  accentSoft: "rgba(42,71,146,0.1)",
  divider: "#e2e8f0",
  shadow: "0 24px 60px rgba(15,23,42,0.18)",
  radius: "24px",
  mode: "light",
});

const THEMES: Record<string, PortfolioConnectTheme> = {
  "elegant-dark": hydrate({
    surface: "#131425",
    border: "rgba(195,145,65,0.18)",
    text: "#f5ede0",
    muted: "#a89880",
    accent: "#cc6a30",
    accentSoft: "rgba(204,106,48,0.12)",
    divider: "rgba(195,145,65,0.12)",
    shadow: "0 24px 60px rgba(0,0,0,0.45)",
    radius: "16px",
    fontFamily: "'Fraunces', serif",
  }),
  "elegant-dark-v2": hydrate({
    surface: "#131425",
    border: "rgba(195,145,65,0.18)",
    text: "#f5ede0",
    muted: "#a89880",
    accent: "#cc6a30",
    accentSoft: "rgba(204,106,48,0.12)",
    radius: "16px",
    fontFamily: "'Fraunces', serif",
  }),
  "elegant-dark-v3": hydrate({
    surface: "#131425",
    border: "rgba(195,145,65,0.18)",
    text: "#f5ede0",
    muted: "#a89880",
    accent: "#cc6a30",
    accentSoft: "rgba(204,106,48,0.12)",
    radius: "16px",
    fontFamily: "'Fraunces', serif",
  }),
  "ocean-gradient": hydrate({
    surface: "#071422",
    border: "rgba(45,210,190,0.28)",
    text: "#e8f4f2",
    muted: "rgba(150,210,200,0.75)",
    accent: "#2dd4b8",
    accentSoft: "rgba(45,212,184,0.12)",
    shadow: "0 24px 60px rgba(0,0,0,0.45)",
    radius: "20px",
    backdropFilter: "blur(18px)",
    fontFamily: "'Manrope', sans-serif",
  }),
  "ocean-gradient-v2": hydrate({
    surface: "#071422",
    border: "rgba(45,210,190,0.28)",
    text: "#e8f4f2",
    muted: "rgba(150,210,200,0.75)",
    accent: "#2dd4b8",
    accentSoft: "rgba(45,212,184,0.12)",
    radius: "20px",
    backdropFilter: "blur(18px)",
    fontFamily: "'Manrope', sans-serif",
  }),
  "ocean-gradient-v3": hydrate({
    surface: "#071422",
    border: "rgba(45,210,190,0.28)",
    text: "#e8f4f2",
    muted: "rgba(150,210,200,0.75)",
    accent: "#2dd4b8",
    accentSoft: "rgba(45,212,184,0.12)",
    radius: "20px",
    backdropFilter: "blur(18px)",
    fontFamily: "'Manrope', sans-serif",
  }),
  "royal-purple": hydrate({
    surface: "#11071f",
    border: "rgba(240,180,41,0.22)",
    text: "#fdfaff",
    muted: "rgba(215,200,245,0.72)",
    accent: "#f1b82d",
    accentSoft: "rgba(241,184,45,0.12)",
    shadow: "0 24px 60px rgba(0,0,0,0.5)",
    radius: "16px",
    fontFamily: "'IBM Plex Mono', monospace",
  }),
  "royal-purple-v2": hydrate({
    surface: "#11071f",
    border: "rgba(168,85,247,0.35)",
    text: "#fdfaff",
    muted: "rgba(215,200,245,0.72)",
    accent: "#f1b82d",
    accentSoft: "rgba(241,184,45,0.12)",
    radius: "12px",
    fontFamily: "'IBM Plex Mono', monospace",
  }),
  "royal-purple-v3": hydrate({
    surface: "#11071f",
    border: "rgba(168,85,247,0.35)",
    text: "#fdfaff",
    muted: "rgba(215,200,245,0.72)",
    accent: "#f1b82d",
    accentSoft: "rgba(241,184,45,0.12)",
    radius: "12px",
    fontFamily: "'IBM Plex Mono', monospace",
  }),
  "green-gold": hydrate({
    surface: "#ffffff",
    border: "#99f6e4",
    text: "#134e4a",
    muted: "#0f766e",
    accent: "#0d9488",
    accentSoft: "#ccfbf1",
    shadow: "0 18px 40px rgba(13,148,136,0.14)",
    radius: "18px",
  }),
  "blue-red": hydrate({
    surface: "#ffffff",
    border: "#93c5fd",
    text: "#1e3a8a",
    muted: "#1d4ed8",
    accent: "#3b82f6",
    accentSoft: "#dbeafe",
    radius: "18px",
  }),
  "hot-orange": hydrate({
    surface: "#ffffff",
    border: "#fdba74",
    text: "#9a3412",
    muted: "#c2410c",
    accent: "#f97316",
    accentSoft: "#ffedd5",
    radius: "18px",
  }),
  "charcoal-yellow": hydrate({
    surface: "#27272a",
    border: "rgba(250,204,21,0.22)",
    text: "#fafafa",
    muted: "#a1a1aa",
    accent: "#facc15",
    accentSoft: "rgba(250,204,21,0.12)",
    radius: "16px",
  }),
  "ocean-blue": hydrate({
    surface: "#1e293b",
    border: "rgba(56,189,248,0.28)",
    text: "#f8fafc",
    muted: "#94a3b8",
    accent: "#38bdf8",
    accentSoft: "rgba(56,189,248,0.12)",
    radius: "16px",
  }),
  "light-blue": hydrate({
    surface: "#ffffff",
    border: "#bfdbfe",
    text: "#0f172a",
    muted: "#64748b",
    accent: "#2563eb",
    accentSoft: "#dbeafe",
    radius: "16px",
  }),
  "carbon-diamond": hydrate({
    surface: "#0F1112",
    border: "rgba(230,247,255,0.16)",
    text: "#F8FBFF",
    muted: "#C9D6DD",
    accent: "#E6F7FF",
    accentSoft: "rgba(230,247,255,0.08)",
    radius: "18px",
  }),
  "void-purple": hydrate({
    surface: "#111215",
    border: "rgba(109,40,217,0.28)",
    text: "#F5F0FF",
    muted: "#C4B5FD",
    accent: "#C4B5FD",
    accentSoft: "rgba(109,40,217,0.18)",
    radius: "18px",
  }),
  "timeless-gold": hydrate({
    surface: "#0F1112",
    border: "rgba(214,176,109,0.28)",
    text: "#f4efe6",
    muted: "#d6b06d",
    accent: "#d6b06d",
    accentSoft: "rgba(214,176,109,0.12)",
    radius: "18px",
  }),
  "ice-variant": hydrate({
    surface: "#f7f8fb",
    border: "rgba(174,183,196,0.45)",
    text: "#111318",
    muted: "#7a828f",
    accent: "#404856",
    accentSoft: "rgba(64,72,86,0.08)",
    shadow: "18px 18px 36px rgba(174,183,196,0.28), -12px -12px 28px rgba(255,255,255,0.9)",
    radius: "24px",
  }),
  "warm-pastel": hydrate({
    surface: "#fffaf4",
    border: "rgba(200,193,184,0.55)",
    text: "#111318",
    muted: "#7a828f",
    accent: "#404856",
    accentSoft: "rgba(64,72,86,0.08)",
    radius: "24px",
  }),
  "midnight-moon": hydrate({
    surface: "#2f3345",
    border: "rgba(122,162,255,0.22)",
    text: "#E6EEF9",
    muted: "#98A6C8",
    accent: "#7AA2FF",
    accentSoft: "rgba(122,162,255,0.14)",
    radius: "24px",
  }),
  "rose-bloom": hydrate({
    surface: "rgba(255,255,255,0.94)",
    border: "rgba(16,185,129,0.18)",
    text: "#374151",
    muted: "#4b5563",
    accent: "#065f46",
    accentSoft: "rgba(16,185,129,0.12)",
    radius: "24px",
    backdropFilter: "blur(20px) saturate(180%)",
    fontFamily: "'Playfair Display', serif",
  }),
  "jasmine-mist": hydrate({
    surface: "rgba(255,255,255,0.94)",
    border: "rgba(244,114,182,0.22)",
    text: "#374151",
    muted: "#4b5563",
    accent: "#be185d",
    accentSoft: "rgba(244,114,182,0.16)",
    radius: "24px",
    backdropFilter: "blur(20px) saturate(180%)",
    fontFamily: "'Playfair Display', serif",
  }),
  "hibiscus-dusk": hydrate({
    surface: "rgba(255,255,255,0.94)",
    border: "rgba(251,146,60,0.24)",
    text: "#374151",
    muted: "#4b5563",
    accent: "#c2410c",
    accentSoft: "rgba(251,146,60,0.16)",
    radius: "24px",
    backdropFilter: "blur(20px) saturate(180%)",
    fontFamily: "'Playfair Display', serif",
  }),
  "classic-gold": hydrate({
    surface: "#0f172a",
    border: "rgba(253,230,138,0.35)",
    text: "#ffffff",
    muted: "rgba(255,255,255,0.72)",
    accent: "#fde68a",
    accentSoft: "rgba(253,230,138,0.16)",
    radius: "4px",
    fontFamily: "'Playfair Display', serif",
  }),
  "ocean-blue-gold": hydrate({
    surface: "#082f49",
    border: "rgba(103,232,249,0.35)",
    text: "#ffffff",
    muted: "rgba(255,255,255,0.72)",
    accent: "#67e8f9",
    accentSoft: "rgba(103,232,249,0.16)",
    radius: "4px",
    fontFamily: "'Playfair Display', serif",
  }),
  "violet-pink": hydrate({
    surface: "#3b0764",
    border: "rgba(249,168,212,0.4)",
    text: "#ffffff",
    muted: "rgba(255,255,255,0.72)",
    accent: "#f9a8d4",
    accentSoft: "rgba(249,168,212,0.16)",
    radius: "4px",
    fontFamily: "'Playfair Display', serif",
  }),
  "pristine-gold": hydrate({
    surface: "#1B1916",
    border: "rgba(201,168,76,0.25)",
    text: "#F2EBD9",
    muted: "#9A8E7C",
    accent: "#C9A84C",
    accentSoft: "rgba(201,168,76,0.12)",
    radius: "4px",
    fontFamily: "'Cormorant Garamond', serif",
  }),
  "blood-rose": hydrate({
    surface: "#1A0A0C",
    border: "rgba(255,75,120,0.28)",
    text: "#F7EAF0",
    muted: "#B8929C",
    accent: "#FF4B78",
    accentSoft: "rgba(255,75,120,0.14)",
    shadow: "0 24px 60px rgba(16,5,7,0.55)",
    radius: "4px",
    fontFamily: "'Cormorant Garamond', serif",
    mode: "dark",
  }),
  "minty-green": hydrate({
    surface: "#FFFFFF",
    border: "rgba(94,126,63,0.22)",
    text: "#1E2718",
    muted: "#66715A",
    accent: "#5E7E3F",
    accentSoft: "rgba(94,126,63,0.12)",
    shadow: "0 18px 40px rgba(94,126,63,0.12)",
    radius: "4px",
    fontFamily: "'Cormorant Garamond', serif",
    mode: "light",
  }),
  "hitachi-solutions": hydrate({
    surface: "#ffffff",
    border: "#e2e8f0",
    text: "#2c3e50",
    muted: "#6c757d",
    accent: "#b10e23",
    accentSoft: "rgba(177,14,35,0.1)",
    shadow: "0 18px 40px rgba(177,14,35,0.12)",
    radius: "12px",
    mode: "light",
  }),
  "bubble-gem": hydrate({
    surface: "rgba(18,16,36,0.94)",
    border: "rgba(255,255,255,0.14)",
    text: "#FFFFFF",
    muted: "rgba(255,255,255,0.62)",
    accent: "#A5B4FC",
    accentSoft: "rgba(59,130,246,0.18)",
    radius: "28px",
    backdropFilter: "blur(28px) saturate(160%)",
  }),
  "frosted-crystal": hydrate({
    surface: "rgba(10,18,32,0.94)",
    border: "rgba(255,255,255,0.12)",
    text: "#FFFFFF",
    muted: "rgba(255,255,255,0.4)",
    accent: "#00D4FF",
    accentSoft: "rgba(0,212,255,0.14)",
    radius: "24px",
    backdropFilter: "blur(16px)",
  }),
  "dark-cinematic": hydrate({
    surface: "#121614",
    border: "rgba(255,255,255,0.1)",
    text: "#FFFFFF",
    muted: "rgba(255,255,255,0.38)",
    accent: "#DFFF4F",
    accentSoft: "rgba(223,255,79,0.14)",
    radius: "24px",
    backdropFilter: "blur(16px)",
  }),
};

THEMES["candy-flush"] = THEMES["rose-bloom"];
THEMES["snow-contrast"] = THEMES["jasmine-mist"];
THEMES["fiery-sunset"] = THEMES["hibiscus-dusk"];

export function resolvePortfolioConnectTheme(
  themeId?: string | null,
  overrides?: Partial<PortfolioConnectTheme>,
): PortfolioConnectTheme {
  const normalized = normalizeThemeId(themeId);
  const base = (normalized && THEMES[normalized]) || DEFAULT_THEME;
  if (!overrides) return base;
  const cleaned = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value != null && value !== ""),
  ) as Partial<PortfolioConnectTheme>;
  return hydrate({ ...base, ...cleaned });
}

/** Shared radius for modal sheets / buttons so templates stay consistent. */
export function portfolioChromeRadius(theme: PortfolioConnectTheme): string {
  return theme.radius ?? "16px";
}

/** Form field chrome for lead capture (theme-aware surface + radius). */
export function portfolioChromeFieldStyle(
  theme: PortfolioConnectTheme,
): Record<string, string> {
  return {
    background:
      theme.mode === "dark" ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.03)",
    border: `1px solid ${theme.border}`,
    color: theme.text,
    borderRadius: portfolioChromeRadius(theme),
    caretColor: theme.accent,
  };
}

export function portfolioChromeErrorStyle(
  theme: PortfolioConnectTheme,
): Record<string, string> {
  if (theme.mode === "dark") {
    return {
      background: "rgba(248,113,113,0.12)",
      color: "#fecaca",
      border: "1px solid rgba(248,113,113,0.3)",
      borderRadius: portfolioChromeRadius(theme),
    };
  }
  return {
    background: "#fef2f2",
    color: "#b91c1c",
    border: "1px solid #fecaca",
    borderRadius: portfolioChromeRadius(theme),
  };
}

export function portfolioChromeSecondaryButtonStyle(
  theme: PortfolioConnectTheme,
): Record<string, string> {
  return {
    border: `1px solid ${theme.border}`,
    color: theme.text,
    background:
      theme.mode === "dark" ? "rgba(255,255,255,0.04)" : "rgba(15,23,42,0.02)",
    borderRadius: portfolioChromeRadius(theme),
  };
}

export function portfolioChromePrimaryButtonStyle(
  theme: PortfolioConnectTheme,
): Record<string, string> {
  return {
    background: theme.accent,
    color: theme.onAccent,
    borderRadius: portfolioChromeRadius(theme),
    boxShadow: `0 10px 24px ${theme.accent}44`,
  };
}

export function portfolioChromeCloseButtonStyle(
  theme: PortfolioConnectTheme,
): Record<string, string> {
  return {
    color: theme.muted,
    background: theme.accentSoft ?? `${theme.accent}14`,
    border: `1px solid ${theme.border}`,
  };
}

export { DEFAULT_THEME as DEFAULT_CONNECT_THEME };
