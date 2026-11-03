// components/BubbleGlass.tsx
import React from "react";
import {
  Sparkles,
  Hash,
  QrCode as QrCodeIcon,
  CalendarDays,
} from "lucide-react";
import { BizCardDetails, getCardSideNavClasses, CardTextWrapStyle } from "./types";

/* ------------------------------------------------------------------
  Theme definitions – based on Floral Madness colorways
  (Rose Bloom, Hibiscus Dusk, Jasmine Mist)
------------------------------------------------------------------ */
const THEMES = {
  "rose-bloom": {
    // Glass card background & border
    cardBg: "rgba(255,255,255,0.14)",
    cardBorder: "1px solid rgba(255,255,255,0.32)",
    cardShadow:
      "0 8px 32px rgba(0,0,0,0.14), inset 0 1px 0 rgba(255,255,255,0.45)",
    // Text colors
    textPrimary: "#ffffff",
    textSecondary: "rgba(255,255,255,0.85)",
    // Badge styles
    badgeBg: "rgba(255,255,255,0.14)",
    badgeBorder: "1px solid rgba(255,255,255,0.25)",
    badgeText: "rgba(255,255,255,0.9)",
    // Icon colors
    sparklesIcon: "#fad643", // yellow
    hashIcon: "#fad643",
    calendarIcon: "#fad643",
    // QR container
    qrContainerBg: "rgba(255,255,255,0.18)",
    qrContainerBorder: "1px solid rgba(255,255,255,0.25)",
    qrIconColor: "#ffffff",
    // Floating orb gradients
    orbTopLeft:
      "radial-gradient(circle, rgba(250,214,67,0.8), transparent 70%)",
    orbBottomRight:
      "radial-gradient(circle, rgba(247,37,133,0.75), transparent 70%)",
    orbBottomCenter:
      "radial-gradient(circle, rgba(136,74,178,0.75), transparent 90%)",
    // Focus ring (Tailwind custom props)
    focusRingColor: "#fad643", // yellow
    focusRingOffset: "#ffffff", // white background behind ring
  },
  "hibiscus-dusk": {
    cardBg: "rgba(10,10,12,0.74)",
    cardBorder: "1px solid rgba(255,255,255,0.14)",
    cardShadow:
      "0 8px 32px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.06)",
    textPrimary: "#ffffff",
    textSecondary: "rgba(255,255,255,0.85)",
    badgeBg: "rgba(255,255,255,0.08)",
    badgeBorder: "1px solid rgba(255,255,255,0.2)",
    badgeText: "rgba(255,255,255,0.9)",
    sparklesIcon: "#ff7a45", // orange
    hashIcon: "#ff7a45",
    calendarIcon: "#ff7a45",
    qrContainerBg: "rgba(255,255,255,0.12)",
    qrContainerBorder: "1px solid rgba(255,255,255,0.18)",
    qrIconColor: "#ffffff",
    orbTopLeft:
      "radial-gradient(circle, rgba(255,122,69,0.8), transparent 70%)",
    orbBottomRight:
      "radial-gradient(circle, rgba(255,62,108,0.75), transparent 70%)",
    orbBottomCenter:
      "radial-gradient(circle, rgba(255,109,94,0.75), transparent 90%)",
    focusRingColor: "#ff7a45",
    focusRingOffset: "#0a0a0c",
  },
  "jasmine-mist": {
    cardBg: "rgba(255,255,255,0.14)",
    cardBorder: "1px solid rgba(255,255,255,0.32)",
    cardShadow:
      "0 8px 32px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.45)",
    textPrimary: "#e6edff", // slate-900
    textSecondary: "rgba(201, 218, 255, 0.85)",
    badgeBg: "rgba(255,255,255,0.2)",
    badgeBorder: "1px solid rgba(15,23,42,0.08)",
    badgeText: "#d0deff",
    sparklesIcon: "#3b82f6", // blue
    hashIcon: "#3b82f6",
    calendarIcon: "#06b6d4", // cyan
    qrContainerBg: "rgba(255,255,255,0.2)",
    qrContainerBorder: "1px solid rgba(15,23,42,0.1)",
    qrIconColor: "#2365ff",
    orbTopLeft:
      "radial-gradient(circle, rgba(255,158,209,0.8), transparent 70%)",
    orbBottomRight:
      "radial-gradient(circle, rgba(34,197,94,0.75), transparent 70%)",
    orbBottomCenter:
      "radial-gradient(circle, rgba(124,58,237,0.75), transparent 90%)",
    focusRingColor: "#3b82f6",
    focusRingOffset: "#ffffff",
  },
} as const;

export type BubbleGlassTheme = keyof typeof THEMES;

const LEGACY_BUBBLE_GLASS_THEME_ALIASES: Record<string, BubbleGlassTheme> = {
  "candy-flush": "rose-bloom",
  "fiery-sunset": "hibiscus-dusk",
  "snow-contrast": "jasmine-mist",
};

interface BubbleGlassProps extends BizCardDetails {
  props: BizCardDetails["props"] & {
    theme?: string;
  };
}

/* ------------------------------------------------------------------
   Component
------------------------------------------------------------------ */
export default function BubbleGlass({ props }: BubbleGlassProps) {
  const { cardName, serialID, dateMade, qrCode, theme = "rose-bloom", onSideNav = false } = props;
  const resolvedTheme =
    (Object.prototype.hasOwnProperty.call(THEMES, theme)
      ? theme
      : LEGACY_BUBBLE_GLASS_THEME_ALIASES[theme ?? ""]) ?? "rose-bloom";
  const C = THEMES[resolvedTheme as BubbleGlassTheme] ?? THEMES['rose-bloom'];
  const shell = getCardSideNavClasses(onSideNav);

  // Resolve QR display – use custom node, URL image, or default icon
  const renderQr = () => {
    if (qrCode) return qrCode;
    if (typeof qrCode === "string") {
      return (
        <img
          src={qrCode}
          alt="QR Code"
          className="h-24 w-24 object-contain transition-all duration-300 group-hover:scale-110 group-focus:scale-110"
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
    <div className={shell.outer}>
      <CardTextWrapStyle />
      {/* Group wrapper to enable group‑hover effects */}
      <div
        className={`${shell.group} ${props.isActive && "ring-2 ring-offset-2 outline-none"}`}
        style={
          {
            "--tw-ring-color": C.focusRingColor,
            "--tw-ring-offset-color": C.focusRingOffset,
          } as React.CSSProperties
        }
      >
        {/* Clickable overlay with dynamic focus ring */}
        <button
          type="button"
          className="absolute h-full w-full z-50 bg-transparent rounded-xl cursor-pointer transition-all duration-300 ease-out hover:shadow-xl focus:shadow-xl focus:outline-none focus:ring-2 focus:ring-offset-2"
          style={
            {
              "--tw-ring-color": C.focusRingColor,
              "--tw-ring-offset-color": C.focusRingOffset,
            } as React.CSSProperties
          }
          aria-label="View card details"
        />

        {/* Card container – glassmorphism */}
        <div
          className={`${shell.card} transition-all duration-300 ease-out`}
          style={{
            background: C.cardBg,
            backdropFilter: "blur(24px) saturate(180%)",
            WebkitBackdropFilter: "blur(24px) saturate(180%)",
            border: C.cardBorder,
            boxShadow: C.cardShadow,
          }}
        >
          {/* Floating Orbs */}
          <div
            className="absolute top-0 left-0 h-20 w-20 rounded-full blur-md"
            style={{ background: C.orbTopLeft }}
          />
          <div
            className="absolute bottom-20 -right-10 h-40 w-40 rounded-full blur-xl"
            style={{ background: C.orbBottomRight }}
          />
          <div
            className="absolute -bottom-14 left-1/2 -translate-x-1/2 h-28 w-28 rounded-full blur-md"
            style={{ background: C.orbBottomCenter }}
          />

          {/* Glass Shine */}
          <div
            className="absolute inset-0 opacity-30"
            style={{
              background:
                "linear-gradient(135deg, rgba(255,255,255,0.25), transparent 55%)",
            }}
          />

          {/* Grain Texture */}
          <div
            className="absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.6) 1px, transparent 0)",
              backgroundSize: "18px 18px",
            }}
          />

          {/* Main content */}
          <div className={shell.content}>
            <div className={shell.grid}>
              {/* LEFT SIDE – name & serial */}
              <div className={shell.leftCol}>
                <div>
                  {/* Badge */}
                  <div
                    className={`mb-3 inline-flex items-center rounded-full ${shell.badge}`}
                    style={{
                      background: C.badgeBg,
                      border: C.badgeBorder,
                    }}
                  >
                    <Sparkles
                      className={shell.sparkles}
                      style={{ color: C.sparklesIcon }}
                    />
                    <span
                      className="text-[8px] font-bold uppercase tracking-[0.18em]"
                      style={{ color: C.badgeText }}
                    >
                      Bubble Glass
                    </span>
                  </div>

                  {/* Card name */}
                  <h1
                    className={`${shell.title} font-bold leading-tight`}
                    style={{
                      color: C.textPrimary,
                      textShadow: "0 2px 12px rgba(0,0,0,0.15)",
                    }}
                  >
                    {cardName}
                  </h1>
                </div>

                {/* Serial ID */}
                <div className={shell.serialRow}>
                  <div className="flex items-center gap-2">
                    <Hash className={shell.hash} style={{ color: C.hashIcon }} />
                    <p
                      className={`${shell.serial} font-semibold tracking-[0.2em]`}
                      style={{ color: C.textSecondary }}
                    >
                      {serialID}
                    </p>
                  </div>
                  {onSideNav && (
                    <div className="flex items-center gap-2">
                      <CalendarDays
                        className={shell.calendar}
                        style={{ color: C.calendarIcon }}
                      />
                      <p
                        className={`${shell.date} font-semibold`}
                        style={{ color: C.textSecondary }}
                      >
                        {dateMade}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT SIDE – QR code & date */}
              {!onSideNav && (
              <div className="col-span-2 flex flex-col justify-between items-end">
                <div className="w-full flex justify-center">
                  <div
                    className="rounded-2xl p-2"
                    style={{
                      background: C.qrContainerBg,
                      border: C.qrContainerBorder,
                      backdropFilter: "blur(12px)",
                    }}
                  >
                    {renderQr()}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <CalendarDays
                    className={shell.calendar}
                    style={{ color: C.calendarIcon }}
                  />
                  <p
                    className={`${shell.date} font-semibold`}
                    style={{ color: C.textSecondary }}
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
