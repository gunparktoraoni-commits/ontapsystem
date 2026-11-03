"use client";

import type { PortfolioViewProps } from "../../../shared";
import LuxuriousEditorialShell, { type LuxePalette } from "../shell";

/* Ocean Blue Gold — misty blue canvas, deep abyssal navy base, luminous cyan + gold. */
const OCEAN_BLUE_GOLD: LuxePalette = {
  variant: "ocean-blue-gold",
  pageBg: "#eaf2f8",
  sectionBg: "rgba(8,25,43,0.88)",
  ink: "#eaf4fb",
  inkMuted: "rgba(234,244,251,0.68)",
  line: "rgba(120,200,220,0.32)",
  accent: "#2f96b4",
  accentAlt: "#66d3e6",
  gold: "#e2c275",
  glowA: "radial-gradient(circle, rgba(102,211,230,0.26), transparent 70%)",
  glowB: "radial-gradient(circle, rgba(226,194,117,0.20), transparent 70%)",
  heroFallback: "linear-gradient(160deg, #08243a 0%, #0d5a7d 48%, #041521 100%)",
  heroOverlay:
    "linear-gradient(to top, rgba(8,25,43,0.96) 0%, rgba(10,45,70,0.52) 38%, rgba(6,20,35,0.26) 100%)",
  onAccent: "#041521",
  scrollbarTrack: "#eaf2f8",
  scrollbarThumb: "#e2c275",
  scrollbarThumbHover: "#2f96b4",
  selectionBg: "#2f96b4",
  selectionText: "#f0f9ff",
};

export default function OceanBlueGold(props: PortfolioViewProps) {
  return <LuxuriousEditorialShell palette={OCEAN_BLUE_GOLD} {...props} />;
}
