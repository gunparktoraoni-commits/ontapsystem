import type { CSSProperties } from "react";

/** Brand-aligned accents — Total Users / primary blue is the dashboard glass tone */
export const PORTAL_ACCENTS = {
  users: "#2A4792",
  orders: "#4785B8",
  companies: "#6366F1",
  affiliates: "#0EA5E9",
  bizcards: "#8B5CF6",
  staff: "#059669",
  product: "#D97706",
  revenue: "#4785B8",
  warning: "#D97706",
  danger: "#EF4444",
} as const;

export type PortalAccentKey = keyof typeof PORTAL_ACCENTS;

/** Unified dashboard accent (Total Users card) */
export const DASHBOARD_ACCENT = PORTAL_ACCENTS.users;

/** Default white shell for non-dashboard portal panels */
export const PORTAL_PANEL_SHELL =
  "rounded-2xl border border-gray-100 bg-white shadow-sm";

/** Shared dashboard glass shell class — frosted card chrome */
export const DASHBOARD_CARD_SHELL =
  "relative overflow-hidden rounded-2xl border backdrop-blur-xl shadow-sm";

/** Full-card gradient glass style — matches Total Users (#2A4792) */
export const DASHBOARD_GLASS_STYLE: CSSProperties = {
  background: `
    linear-gradient(145deg, rgba(42,71,146,0.42) 0%, rgba(42,71,146,0.12) 42%, rgba(8,14,30,0.92) 100%),
    linear-gradient(160deg, #0b1220 0%, #0a1324 55%, #07101c 100%)
  `,
  borderColor: "rgba(42,71,146,0.38)",
  boxShadow: `
    0 10px 28px rgba(8,14,30,0.22),
    0 0 0 1px rgba(42,71,146,0.08),
    inset 0 1px 0 rgba(255,255,255,0.08)
  `,
};

/** Consistent min-height for dashboard row cards */
export const DASHBOARD_CARD_MIN_H = "h-full xl:min-h-[400px]";

/** Inner panel — subtle blue-tinted glass nested surface */
export const DASHBOARD_DARK_PANEL_STYLE: CSSProperties = {
  background:
    "linear-gradient(160deg, rgba(42,71,146,0.22) 0%, rgba(11,18,32,0.88) 45%, rgba(8,14,30,0.94) 100%)",
  border: "1px solid rgba(42,71,146,0.32)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
};

/** Thin scrollbar styled for dark dashboard panels */
export const DASHBOARD_SCROLLBAR_CLASS =
  "scrollbar-thin overflow-y-auto [scrollbar-color:rgba(42,71,146,0.45)_transparent] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[rgba(42,71,146,0.45)] hover:[&::-webkit-scrollbar-thumb]:bg-[rgba(42,71,146,0.65)]";

/** Title / subtitle colors on glass cards */
export const DASHBOARD_TITLE_CLASS =
  "text-lg font-extrabold tracking-tight text-white";
export const DASHBOARD_SUBTITLE_CLASS = "text-xs font-medium text-slate-400";
