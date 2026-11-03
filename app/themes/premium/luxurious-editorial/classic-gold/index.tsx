"use client";

import type { PortfolioViewProps } from "../../../shared";
import LuxuriousEditorialShell, { type LuxePalette } from "../shell";

/* Classic Gold — warm champagne canvas, deep espresso editorial base, gilded accents. */
const CLASSIC_GOLD: LuxePalette = {
  variant: "classic-gold",
  pageBg: "#f6efe3",
  sectionBg: "rgba(23,17,11,0.86)",
  ink: "#f7f1e6",
  inkMuted: "rgba(247,241,230,0.68)",
  line: "rgba(216,185,120,0.35)",
  accent: "#a9773a",
  accentAlt: "#e4c07a",
  gold: "#d8b978",
  glowA: "radial-gradient(circle, rgba(216,185,120,0.28), transparent 70%)",
  glowB: "radial-gradient(circle, rgba(169,119,58,0.22), transparent 70%)",
  heroFallback: "linear-gradient(160deg, #2a1c0e 0%, #4a3115 45%, #1a1108 100%)",
  heroOverlay:
    "linear-gradient(to top, rgba(23,17,11,0.96) 0%, rgba(35,24,12,0.55) 38%, rgba(20,14,8,0.28) 100%)",
  onAccent: "#1a1108",
  scrollbarTrack: "#f6efe3",
  scrollbarThumb: "#d8b978",
  scrollbarThumbHover: "#a9773a",
  selectionBg: "#a9773a",
  selectionText: "#fffaf0",
};

export default function ClassicGold(props: PortfolioViewProps) {
  return <LuxuriousEditorialShell palette={CLASSIC_GOLD} {...props} />;
}
