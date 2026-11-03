import type { ThemeDef } from "@/app/themes/shared";

export type DigitalBizCardTheme = {
  gradient: string;
  headerGradient: string;
  text: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
};

export function toDigitalBizCardTheme(theme: ThemeDef): DigitalBizCardTheme {
  return {
    gradient: theme.gradient,
    headerGradient: theme.headerGradient,
    text: theme.text,
    textMuted: theme.textMuted,
    accent: theme.accent,
    accentSoft: theme.accentSoft,
  };
}

export function defaultDigitalBizCardTheme(): DigitalBizCardTheme {
  return {
    gradient: "linear-gradient(135deg,#080912 0%,#cc6a30 55%,#eaa05c 100%)",
    headerGradient: "linear-gradient(160deg,#080912 0%,#0f1020 55%,#131425 100%)",
    text: "#f5ede0",
    textMuted: "rgba(168,152,128,0.85)",
    accent: "#cc6a30",
    accentSoft: "rgba(204,106,48,0.10)",
  };
}
