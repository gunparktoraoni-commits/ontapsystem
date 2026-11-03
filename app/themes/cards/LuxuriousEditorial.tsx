// components/LuxuriousEditorial.tsx
import React from "react";
import {
  Sparkles,
  Hash,
  QrCode as QrCodeIcon,
  CalendarDays,
} from "lucide-react";
import { BizCardDetails, getCardSideNavClasses, CardTextWrapStyle } from "./types";

/* ------------------------------------------------------------------
   Theme palettes – matched to portfolio design tokens in
   app/themes/premium/luxurious-editorial/index.tsx
------------------------------------------------------------------ */
import CspStyle from '@/app/components/CspStyle';

type CardPalette = {
  cardBg: string;
  cardBorder: string;
  cardShadow: string;
  textPrimary: string;
  textSecondary: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  sparklesIcon: string;
  hashIcon: string;
  calendarIcon: string;
  qrIconColor: string;
  topAccentGrad: string;
  hoverGlow: string;
  ambientGold: string;
  ambientSoft: string;
  paperGrainColor: string;
  editorialLineGrad: string;
  cornerBorderColor: string;
  cornerBorderOpacity: string;
  dividerLineColor: string;
  dividerLineLight: string;
  focusRingColor: string;
  focusRingOffset: string;
};

const CLASSIC_GOLD: CardPalette = {
  // Tokens: bg #fefae0, text #000, accent #6f4518, accentAlt #f3d5b5, muted #6B5A44
  cardBg: "linear-gradient(180deg, #fffcf2 0%, #fefae0 100%)",
  cardBorder: "1px solid #f3d5b5",
  cardShadow: "0 8px 30px rgba(111,69,24,0.12)",
  textPrimary: "#000000",
  textSecondary: "#6B5A44",
  badgeBg: "rgba(111,69,24,0.10)",
  badgeBorder: "1px solid rgba(111,69,24,0.20)",
  badgeText: "#6f4518",
  sparklesIcon: "#6f4518",
  hashIcon: "#6f4518",
  calendarIcon: "#6f4518",
  qrIconColor: "#6f4518",
  topAccentGrad: "linear-gradient(90deg, transparent, #6f4518, transparent)",
  hoverGlow: "inset 0 0 24px rgba(111,69,24,0.12)",
  ambientGold: "rgba(111,69,24,0.10)",
  ambientSoft: "rgba(243,213,181,0.30)",
  paperGrainColor: "rgba(111,69,24,0.12)",
  editorialLineGrad:
    "linear-gradient(to bottom, transparent, #f3d5b5, transparent)",
  cornerBorderColor: "#6f4518",
  cornerBorderOpacity: "0.30",
  dividerLineColor: "#6f4518",
  dividerLineLight: "#f3d5b5",
  focusRingColor: "#6f4518",
  focusRingOffset: "#fefae0",
};

const OCEAN_BLUE_GOLD: CardPalette = {
  // Tokens: bg #e8f1f7, text #0f2944, accent #0d5a7d, accentAlt #d4af37, muted #4a6fa5
  cardBg: "linear-gradient(180deg, #f0f7ff 0%, #e8f1f7 100%)",
  cardBorder: "1px solid rgba(212,175,55,0.55)",
  cardShadow: "0 8px 30px rgba(13,90,125,0.14)",
  textPrimary: "#0f2944",
  textSecondary: "#4a6fa5",
  badgeBg: "rgba(13,90,125,0.10)",
  badgeBorder: "1px solid rgba(212,175,55,0.45)",
  badgeText: "#0d5a7d",
  sparklesIcon: "#d4af37",
  hashIcon: "#0d5a7d",
  calendarIcon: "#0d5a7d",
  qrIconColor: "#0d5a7d",
  topAccentGrad:
    "linear-gradient(90deg, transparent, #0d5a7d, #d4af37, transparent)",
  hoverGlow: "inset 0 0 24px rgba(13,90,125,0.12)",
  ambientGold: "rgba(212,175,55,0.16)",
  ambientSoft: "rgba(13,90,125,0.12)",
  paperGrainColor: "rgba(13,90,125,0.10)",
  editorialLineGrad:
    "linear-gradient(to bottom, transparent, #d4af37, transparent)",
  cornerBorderColor: "#d4af37",
  cornerBorderOpacity: "0.45",
  dividerLineColor: "#0d5a7d",
  dividerLineLight: "#d4af37",
  focusRingColor: "#0d5a7d",
  focusRingOffset: "#e8f1f7",
};

const VIOLET_PINK: CardPalette = {
  // Tokens: bg #f5f0ff, text #2d1b4e, accent #6b46c1, accentAlt #ec4899, muted #8b5cf6
  cardBg: "linear-gradient(180deg, #faf5ff 0%, #f5f0ff 100%)",
  cardBorder: "1px solid rgba(236,72,153,0.40)",
  cardShadow: "0 8px 30px rgba(107,70,193,0.14)",
  textPrimary: "#2d1b4e",
  textSecondary: "#8b5cf6",
  badgeBg: "rgba(107,70,193,0.10)",
  badgeBorder: "1px solid rgba(236,72,153,0.35)",
  badgeText: "#6b46c1",
  sparklesIcon: "#ec4899",
  hashIcon: "#6b46c1",
  calendarIcon: "#6b46c1",
  qrIconColor: "#6b46c1",
  topAccentGrad:
    "linear-gradient(90deg, transparent, #6b46c1, #ec4899, transparent)",
  hoverGlow: "inset 0 0 24px rgba(107,70,193,0.12)",
  ambientGold: "rgba(236,72,153,0.14)",
  ambientSoft: "rgba(107,70,193,0.12)",
  paperGrainColor: "rgba(107,70,193,0.10)",
  editorialLineGrad:
    "linear-gradient(to bottom, transparent, #ec4899, transparent)",
  cornerBorderColor: "#ec4899",
  cornerBorderOpacity: "0.45",
  dividerLineColor: "#6b46c1",
  dividerLineLight: "#ec4899",
  focusRingColor: "#6b46c1",
  focusRingOffset: "#f5f0ff",
};

const THEMES = {
  "classic-gold": CLASSIC_GOLD,
  "ocean-blue-gold": OCEAN_BLUE_GOLD,
  /** Alias used by some portfolio folders / legacy IDs */
  "blue-gold": OCEAN_BLUE_GOLD,
  "violet-pink": VIOLET_PINK,
  /** Alias used by some portfolio folders / legacy IDs */
  "grainy-white": VIOLET_PINK,
} as const;

export type LuxuriousEditorialTheme = keyof typeof THEMES;

interface LuxuriousEditorialProps extends BizCardDetails {
  props: BizCardDetails["props"] & {
    theme?: LuxuriousEditorialTheme; // override the generic string with the strict union
  };
}

/* ------------------------------------------------------------------
   Google Fonts import (Cormorant Garamond for headings)
------------------------------------------------------------------ */
const FONT_STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,500&display=swap');

/* Text wrap for headings, paragraphs, and spans */
:is(h1, h2, h3, h4, h5, h6, p, span) {
  overflow-wrap: break-word;
  word-wrap: break-word;
  word-break: normal;
  text-wrap: wrap;
}
`;

/* ------------------------------------------------------------------
   Component
------------------------------------------------------------------ */
export default function LuxuriousEditorial({ props }: LuxuriousEditorialProps) {
  const {
    cardName,
    serialID,
    dateMade,
    qrCode,
    theme = "classic-gold",
    onSideNav = false,
  } = props;
  const C = THEMES[theme] ?? THEMES['classic-gold'];
  const shell = getCardSideNavClasses(onSideNav);

  // Resolve QR display – use custom node, URL image, or default icon
  const renderQr = () => {
    if (qrCode) return qrCode;
    if (typeof qrCode === "string") {
      return (
        <img
          src={qrCode}
          alt="QR Code"
          className="h-24 w-24 transition-all duration-300 group-hover:scale-110 group-focus:scale-110"
        />
      );
    }
    return (
      <QrCodeIcon
        className="h-24 w-24 transition-all duration-300 group-hover:scale-110 group-focus:scale-110"
        style={{ color: C.qrIconColor }}
      />
    );
  };

  return (
    <div className={`group ${shell.outer}`}>
      <CardTextWrapStyle />
      {/* Inject fonts */}
      <CspStyle dangerouslySetInnerHTML={{ __html: FONT_STYLE }} />

      {/* Group wrapper to enable group‑hover effects */}
      <div
        className={`${shell.group} ${props.isActive && "ring-2 ring-offset-2 outline-none"}`}
        style={
          {
            "--tw-ring-color": C.focusRingOffset,
            "--tw-ring-offset-color": C.focusRingColor,
          } as React.CSSProperties
        }
      >
        {/* Clickable overlay with dynamic focus ring */}
        <button
          type="button"
          className="absolute h-full w-full z-50 bg-transparent rounded-xl cursor-pointer transition-all duration-300 ease-out hover:shadow-xl focus:shadow-xl focus:outline-none focus:ring-2 focus:ring-offset-2"
          style={
            {
              "--tw-ring-color": C.focusRingOffset,
              "--tw-ring-offset-color": C.focusRingColor,
            } as React.CSSProperties
          }
          aria-label="View card details"
        />

        {/* Card container */}
        <div
          className={`${shell.card} shadow-2xl transition-all duration-300 ease-out`}
          style={{
            background: C.cardBg,
            border: C.cardBorder,
            boxShadow: C.cardShadow,
          }}
        >
          {/* Luxury Gold Top Accent */}
          <div
            className="absolute top-0 left-0 right-0 h-[2px]"
            style={{ background: C.topAccentGrad }}
          />

          {/* Hover Glow */}
          <div
            className={`${shell.glow} opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus:opacity-100`}
            style={{ boxShadow: C.hoverGlow }}
          />

          {/* Warm Gold Ambient Glow */}
          <div
            className="pointer-events-none absolute -top-20 -right-16 h-64 w-64 rounded-full blur-3xl transition-all duration-500 group-hover:bg-opacity-20"
            style={{ background: C.ambientGold }}
          />

          {/* Soft Cream Glow */}
          <div
            className="pointer-events-none absolute -bottom-24 -left-20 h-72 w-72 rounded-full blur-3xl transition-all duration-500"
            style={{ background: C.ambientSoft }}
          />

          {/* Premium Paper Grain */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.08]"
            style={{
              backgroundImage: `radial-gradient(circle at 1px 1px, ${C.paperGrainColor} 1px, transparent 0)`,
              backgroundSize: "18px 18px",
            }}
          />

          {/* Decorative Editorial Line */}
          <div
            className="absolute right-0 top-0 h-full w-px bg-gradient-to-b from-transparent via-[#f3d5b5] to-transparent opacity-60"
            style={{ background: C.editorialLineGrad }}
          />

          {/* Main content */}
          <div className={shell.content}>
            <div className={shell.grid}>
              {/* LEFT SIDE */}
              <div className={shell.leftCol}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    {/* Theme Badge */}
                    <div
                      className={`mb-3 inline-flex items-center rounded-full border tracking-wide font-bold tracking-[0.18em] uppercase transition-all duration-300 group-hover:border-opacity-40 group-hover:bg-opacity-15 ${shell.badge}`}
                      style={{
                        borderColor: C.badgeBorder,
                        background: C.badgeBg,
                        color: C.badgeText,
                        fontFamily: "'Cormorant Garamond', serif",
                      }}
                    >
                      <Sparkles
                        className={`${shell.sparkles} transition-transform duration-300 group-hover:rotate-12 group-focus:rotate-12`}
                        style={{ color: C.sparklesIcon }}
                      />
                      Luxurious Editorial
                    </div>

                    {/* Card Name */}
                    <h1
                      className={`${shell.title} font-semibold tracking-tight`}
                      style={{
                        color: C.textPrimary,
                        fontFamily: "'Cormorant Garamond', serif",
                      }}
                    >
                      {cardName}
                    </h1>

                    {/* Decorative Editorial Divider */}
                    <div className="mt-2 flex items-center gap-2">
                      <div
                        className="h-[1px] w-6"
                        style={{ background: C.dividerLineColor }}
                      />
                      <div
                        className="h-[1px] w-12"
                        style={{ background: C.dividerLineLight }}
                      />
                    </div>
                  </div>
                </div>

                {/* Serial ID */}
                <div className={shell.serialRow}>
                  <div
                    className="mb-1 flex items-center gap-1 font-light uppercase tracking-[0.18em] text-[0.5rem]"
                    style={{ color: C.textSecondary }}
                  >
                    <Hash className={shell.hash} style={{ color: C.hashIcon }} />
                    <p
                      className={`${shell.serial} font-light tracking-tighter break-all`}
                      style={{ color: C.textPrimary }}
                    >
                      {serialID}
                    </p>
                  </div>
                  {onSideNav && (
                    <div
                      className="mb-1 flex items-center gap-2 text-[0.5rem] font-semibold uppercase tracking-[0.18em]"
                      style={{ color: C.textSecondary }}
                    >
                      <CalendarDays
                        className={`${shell.calendar} transition-transform duration-300 group-hover:rotate-12 group-focus:rotate-12`}
                        style={{ color: C.calendarIcon }}
                      />
                      <p
                        className={`${shell.date} font-light tracking-tighter`}
                        style={{ color: C.textPrimary }}
                      >
                        {dateMade}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT SIDE */}
              {!onSideNav && (
              <div className="col-span-2 flex h-full w-full flex-col justify-between items-end">
                {/* QR Section */}
                <div className="flex w-full items-center justify-center">
                  <div className="relative w-full aspect-square flex items-center justify-center">
                    {/* Premium QR Frame */}
                    <div className="rounded-xl p-2 transition-all duration-300">
                      {renderQr()}
                    </div>
                  </div>
                </div>

                {/* Date */}
                <div
                  className="mb-1 flex items-center gap-2 text-[0.5rem] font-semibold uppercase tracking-[0.18em]"
                  style={{ color: C.textSecondary }}
                >
                  <CalendarDays
                    className={`${shell.calendar} transition-transform duration-300 group-hover:rotate-12 group-focus:rotate-12`}
                    style={{ color: C.calendarIcon }}
                  />
                  <p
                    className={`${shell.date} font-light tracking-tighter`}
                    style={{ color: C.textPrimary }}
                  >
                    {dateMade}
                  </p>
                </div>
              </div>
              )}
            </div>
          </div>

          {/* Luxury Corner Decorations */}
          <div
            className="absolute top-2 right-2 h-4 w-4 border-t border-r rounded-tr-md"
            style={{
              borderColor: C.cornerBorderColor,
              opacity: Number(C.cornerBorderOpacity) || 0.4,
              borderTopWidth: "1px",
              borderRightWidth: "1px",
            }}
          />
          <div
            className="absolute bottom-2 left-2 h-4 w-4 border-b border-l rounded-bl-md"
            style={{
              borderColor: C.cornerBorderColor,
              opacity: Number(C.cornerBorderOpacity) || 0.4,
              borderBottomWidth: "1px",
              borderLeftWidth: "1px",
            }}
          />
        </div>
      </div>
    </div>
  );
}
