"use client";

import type { PortfolioViewProps } from "../../../shared";
import LuxuriousEditorialShell, { type LuxePalette } from "../shell";

/* Violet Pink — soft lilac canvas, deep aubergine base, orchid + rose-gold accents. */
const VIOLET_PINK: LuxePalette = {
  variant: "violet-pink",
  pageBg: "#f4eefc",
  sectionBg: "rgba(27,16,48,0.88)",
  ink: "#f4ecff",
  inkMuted: "rgba(244,236,255,0.68)",
  line: "rgba(200,140,235,0.32)",
  accent: "#8b46c9",
  accentAlt: "#f472b6",
  gold: "#e9c6a1",
  glowA: "radial-gradient(circle, rgba(176,107,255,0.28), transparent 70%)",
  glowB: "radial-gradient(circle, rgba(244,114,182,0.22), transparent 70%)",
  heroFallback: "linear-gradient(160deg, #241041 0%, #4c1d95 46%, #160a2b 100%)",
  heroOverlay:
    "linear-gradient(to top, rgba(27,16,48,0.96) 0%, rgba(46,24,80,0.55) 38%, rgba(20,12,38,0.28) 100%)",
  onAccent: "#1a0b2e",
  scrollbarTrack: "#f4eefc",
  scrollbarThumb: "#b06bff",
  scrollbarThumbHover: "#8b46c9",
  selectionBg: "#8b46c9",
  selectionText: "#faf5ff",
};

export default function VioletPink(props: PortfolioViewProps) {
  return <LuxuriousEditorialShell palette={VIOLET_PINK} {...props} />;
}
