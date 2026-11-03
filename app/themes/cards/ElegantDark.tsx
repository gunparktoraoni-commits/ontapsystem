// components/ElegantDark.tsx
import React from "react";
import {
  Sparkles,
  Hash,
  QrCode as QrCodeIcon,
  CalendarDays,
} from "lucide-react";
import { BizCardDetails, CARD_TEXT_WRAP_CLASS, CARD_TEXT_WRAP_CSS } from "./types";

/* ------------------------------------------------------------------
   Theme palettes – identical to the three portfolio templates
   (original = ElegantDark, v2 = ElegantDarkV2, v3 = ElegantDarkV3)
   Added focusRingColor and focusRingOffset for each theme.
------------------------------------------------------------------ */
import CspStyle from '@/app/components/CspStyle';
const THEMES = {
  original: {
    bg: "#0c0b0f",
    surface: "#14131a",
    surfaceAlt: "#1a1922",
    glass: "rgba(255,245,230,0.02)",
    border: "rgba(255,200,120,0.08)",
    borderHov: "rgba(255,200,120,0.18)",
    text: "#f5f0e8",
    textSoft: "#e8dfd2",
    muted: "#9a8e7f",
    accent: "#e8734a",
    accentWarm: "#f4a261",
    accentSoft: "rgba(232,115,74,0.10)",
    accentGlow: "rgba(244,162,97,0.06)",
    gold: "#d4a853",
    cream: "#fdf6ec",
    headerGrad: "linear-gradient(165deg, #1a1922 0%, #0c0b0f 100%)",
    bgGrad: "linear-gradient(180deg, #0c0b0f 0%, #110f16 50%, #0c0b0f 100%)",
    verified: "#10b981",
    focusRingColor: "#f4a261", // accentWarm
    focusRingOffset: "#0c0b0f", // bg
  },
  v2: {
    bg: "#0a0c14",
    surface: "#111827",
    surfaceAlt: "#1a2035",
    glass: "rgba(200,220,255,0.02)",
    border: "rgba(100,160,255,0.09)",
    borderHov: "rgba(100,160,255,0.20)",
    text: "#e8edf8",
    textSoft: "#d0d8f0",
    muted: "#7a8aaa",
    accent: "#4f8ef7",
    accentWarm: "#7eb0ff",
    accentSoft: "rgba(79,142,247,0.10)",
    accentGlow: "rgba(126,176,255,0.06)",
    gold: "#a8c8ff",
    cream: "#eef4ff",
    headerGrad: "linear-gradient(165deg, #1a2035 0%, #0a0c14 100%)",
    bgGrad: "linear-gradient(180deg, #0a0c14 0%, #0e1220 50%, #0a0c14 100%)",
    verified: "#10b981",
    focusRingColor: "#7eb0ff", // accentWarm
    focusRingOffset: "#0a0c14", // bg
  },
  v3: {
    bg: "#0d080a",
    surface: "#1a0d10",
    surfaceAlt: "#251218",
    glass: "rgba(255,210,210,0.02)",
    border: "rgba(255,120,120,0.09)",
    borderHov: "rgba(255,120,120,0.20)",
    text: "#f8eded",
    textSoft: "#e8d4d4",
    muted: "#9a7a7e",
    accent: "#e85474",
    accentWarm: "#f4748e",
    accentSoft: "rgba(232,84,116,0.10)",
    accentGlow: "rgba(244,116,142,0.06)",
    gold: "#c87a8a",
    cream: "#fdf0f2",
    headerGrad: "linear-gradient(165deg, #251218 0%, #0d080a 100%)",
    bgGrad: "linear-gradient(180deg, #0d080a 0%, #130a0d 50%, #0d080a 100%)",
    verified: "#10b981",
    focusRingColor: "#f4748e", // accentWarm
    focusRingOffset: "#0d080a", // bg
  },
} as const;

export type ElegantDarkTheme = keyof typeof THEMES;

// Extend the shared interface with the specific theme type for this component
interface ElegantDarkProps extends BizCardDetails {
  props: BizCardDetails["props"] & {
    theme?: ElegantDarkTheme; // override the generic string with the strict union
  };
}
/* ------------------------------------------------------------------
   Global keyframes (identical to portfolio templates)
------------------------------------------------------------------ */
const KEYFRAMES = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=DM+Sans:wght@300;400;500;600;700&display=swap');

@keyframes elegantFloat {
  0%, 100% { transform: translateY(0px) rotate(0deg); }
  50% { transform: translateY(-8px) rotate(1deg); }
}
@keyframes elegantPulse {
  0%, 100% { opacity: 0.4; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.05); }
}
@keyframes orbFloat {
  0%, 100% { transform: translate(0, 0); }
  33% { transform: translate(12px, -8px); }
  66% { transform: translate(-6px, 4px); }
}

/* Text wrap for headings, paragraphs, and spans */
:is(h1, h2, h3, h4, h5, h6, p, span) {
  overflow-wrap: break-word;
  word-wrap: break-word;
  word-break: normal;
  text-wrap: wrap;
}
`;

export default function ElegantDark({ props }: ElegantDarkProps) {
  const {
    cardName,
    serialID,
    dateMade,
    qrCode,
    theme = "original",
    onSideNav = false,
  } = props;
  const C = THEMES[theme] ?? THEMES['original'];

  // Resolve QR display – use custom node, URL image, or default icon
  const renderQr = () => {
    if (qrCode) return qrCode;
    if (typeof qrCode === "string") {
      return (
        <img
          src={qrCode}
          alt="QR Code"
          className="h-28 w-28 object-contain transition-all duration-300 group-hover:scale-110 group-focus:scale-110"
        />
      );
    }
    return (
      <QrCodeIcon
        className="h-28 w-28 transition-all duration-300 group-hover:scale-110 group-focus:scale-110"
        style={{ color: C.accent }}
      />
    );
  };

  return (
    <div
      className={`${CARD_TEXT_WRAP_CLASS} ${!onSideNav ? "min-w-xs max-w-xs" : "w-full aspect-video"} flex items-center justify-center relative`}
    >
      {/* Inject keyframes and font imports */}
      <CspStyle dangerouslySetInnerHTML={{ __html: KEYFRAMES + CARD_TEXT_WRAP_CSS }} />

      {/* Group wrapper to enable group‑hover effects */}
      <div
        className={`group relative h-max ${!onSideNav ? "rounded-xl w-max" : "rounded-md w-full"} flex items-center justify-center ${props.isActive && "ring-2 ring-offset-2 outline-none"}`}
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
          className={`relative w-full aspect-video overflow-hidden ${!onSideNav ? "rounded-xl" : "rounded-md"} border border-white/10 shadow-2xl transition-all duration-300 ease-out`}
          style={{
            background: `linear-gradient(180deg, ${C.bg} 0%, ${C.surface} 100%)`,
            boxShadow: "0 5px 20px rgba(0,0,0,0.45)",
          }}
        >
          {/* Hover/focus glow effect */}
          <div
            className={`pointer-events-none absolute inset-0 ${!onSideNav ? "rounded-xl" : "rounded-md"} opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus:opacity-100`}
            style={{ boxShadow: `inset 0 0 20px ${C.accent}33` }}
          />

          {/* Ambient glowing orbs */}
          <div
            className="pointer-events-none absolute -top-20 -right-16 h-64 w-64 rounded-full transition-all duration-500 group-hover:opacity-100 group-focus:opacity-100"
            style={{
              background: `radial-gradient(circle, ${C.accent}1A, transparent)`,
              animation: "elegantPulse 8s ease-in-out infinite",
            }}
          />
          <div
            className="pointer-events-none absolute -bottom-24 -left-20 h-72 w-72 rounded-full transition-all duration-500 group-hover:opacity-100 group-focus:opacity-100"
            style={{
              background: `radial-gradient(circle, ${C.gold}1A, transparent)`,
              animation: "elegantPulse 10s ease-in-out infinite 2s",
            }}
          />

          {/* Subtle grain texture */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.08]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.22) 1px, transparent 0)",
              backgroundSize: "18px 18px",
            }}
          />

          {/* Main card content */}
          <div
            className={`relative z-10 h-full ${!onSideNav ? "p-3" : "w-full py-1 px-1.5"}`}
          >
            <div
              className={`grid h-full ${!onSideNav ? "grid-cols-5" : "w-full grid-cols-1"} gap-2`}
            >
              {/* Left side – name and serial */}
              <div
                className={
                  onSideNav
                    ? " flex h-full w-full flex-col justify-between rounded-lg"
                    : "col-span-3 flex flex-col h-full justify-between items-start"
                }
              >
                <div className="w-full flex items-start justify-between gap-4">
                  <div className="flex flex-col w-full items-start">
                    {/* Badge with sparkle icon */}
                    <div
                      className={`mb-3 inline-flex items-center  rounded-full border ${!onSideNav ? "px-3 py-1 gap-3 text-[8px]" : "px-1.5 py-0.5 gap-1.5 text-[7px]"} font-semibold tracking-[0.18em] uppercase transition-all duration-300 group-hover:border-opacity-100 group-focus:border-opacity-100`}
                      style={{
                        borderColor: `${C.accent}33`,
                        background: `${C.accent}1A`,
                        color: C.text,
                      }}
                    >
                      <Sparkles
                        className={`${!onSideNav ? "h-4 w-4" : "h-3 w-3"} transition-transform duration-300 group-hover:rotate-12 group-focus:rotate-12`}
                        style={{ color: C.accent }}
                      />
                      Elegant Dark
                    </div>
                    {/* Card name */}
                    <h1
                      className={`${!onSideNav ? "text-2xl" : "text-lg"} font-semibold tracking-tight`}
                      style={{ color: C.text }}
                    >
                      {cardName}
                    </h1>
                  </div>
                </div>

                {/* Serial ID row */}
                <div className={onSideNav ? "w-full flex items-center justify-between" : ""}>
                  <div className="mb-1 flex items-center gap-1 font-light uppercase tracking-[0.18em] text-[0.5rem]">
                    <Hash className={!onSideNav ? "h-3 w-3" : "h-2.5 w-2.5"} style={{ color: C.accent }} />
                    <p
                      className={`${onSideNav ? "text-[8px]" : "text-xs"} font-medium tracking-widest break-all`}
                      style={{ color: C.textSoft }}
                    >
                      {serialID}
                    </p>
                  </div>
                  {onSideNav && (
                    <div className="mb-1 flex items-center gap-2 text-[0.5rem] font-semibold uppercase tracking-[0.18em]">
                      <CalendarDays
                        className="h-2.5 w-2.5 transition-transform duration-300 group-hover:rotate-12 group-focus:rotate-12"
                        style={{ color: C.accent }}
                      />
                      <p
                        className="text-[8px] font-medium"
                        style={{ color: C.textSoft }}
                      >
                        {dateMade}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right side – QR code and date */}
              {!onSideNav && (
                <div className="col-span-2 flex h-full w-full flex-col justify-between items-end">
                  <div className="flex w-full items-center justify-center">
                    <div className="relative w-full aspect-square flex items-center justify-center">
                      {renderQr()}
                    </div>
                  </div>
                  <div className="mb-1 flex items-center gap-2 text-[0.5rem] font-semibold uppercase tracking-[0.18em]">
                    <CalendarDays
                      className="h-3 w-3 transition-transform duration-300 group-hover:rotate-12 group-focus:rotate-12"
                      style={{ color: C.accent }}
                    />
                    <p
                      className="text-xs font-medium"
                      style={{ color: C.textSoft }}
                    >
                      {dateMade}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
