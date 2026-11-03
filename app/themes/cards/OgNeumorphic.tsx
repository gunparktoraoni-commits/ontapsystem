// components/OgNeumorphic.tsx
import React from "react";
import {
  Sparkles,
  Hash,
  QrCode as QrCodeIcon,
  CalendarDays,
} from "lucide-react";
import { BizCardDetails, getCardSideNavClasses, CardTextWrapStyle } from "./types";

/* ------------------------------------------------------------------
   Theme definitions – based on the three portfolio templates
   (IceVariant, MidnightMoon, WarmPastel)
------------------------------------------------------------------ */
const THEMES = {
  ice: {
    // Card container – cooler, with a hint of glacial blue
    cardBg:
      "linear-gradient(145deg, rgba(245,250,255,0.96), rgba(215,228,245,0.85))",
    cardBorder: "1px solid rgba(255,255,255,0.85)",
    cardShadow:
      "5px 5px 10px rgba(140,160,190,0.5), -5px -5px 16px rgba(255,255,255,0.7)",
    // Text – crisp, cool dark blue-gray
    textPrimary: "#1E2A3E",
    textSecondary: "#5C6F8F",
    badgeText: "#3A6B8C",
    // Badge – translucent with icy white
    badgeBg: "rgba(255,255,255,0.65)",
    badgeBorder: "1px solid rgba(255,255,255,0.9)",
    badgeShadow:
      "6px 6px 12px rgba(120,140,170,0.25), -6px -6px 12px rgba(255,255,255,0.95)",
    // Icons – pale ice blue
    sparklesIcon: "#89B9E2",
    hashIcon: "#89B9E2",
    calendarIcon: "#89B9E2",
    // QR container – frosted glass with icy tint
    qrBg: "rgba(235,245,255,0.75)",
    qrBorder: "1px solid rgba(255,255,255,0.85)",
    qrShadow:
      "10px 10px 22px rgba(100,130,160,0.3), -10px -10px 22px rgba(255,255,255,0.95)",
    qrIconColor: "#4A7C9C",
    // Glows – cool blue-white
    ambientTop: "rgba(180,220,255,0.5)",
    ambientBottom: "rgba(150,190,230,0.4)",
    hoverGlow:
      "inset 0 0 40px rgba(210,230,255,0.9), inset 0 0 80px rgba(100,150,200,0.3)",
    grainColor: "rgba(0,0,0,0.08)",
    // Focus ring – ice blue
    focusRingColor: "#89B9E2",
    focusRingOffset: "#F0F8FF",
  },
  moon: {
    cardBg: "linear-gradient(145deg, rgba(47,51,69,0.95), rgba(37,40,54,0.85))",
    cardBorder: "1px solid rgba(47,51,69,0.60)",
    cardShadow:
      "5px 5px 10px rgba(20,21,27,0.7), -5px -5px 16px rgba(47,51,69,0.6)",
    textPrimary: "#E6EEF9",
    textSecondary: "#98A6C8",
    badgeText: "#98A6C8",
    badgeBg: "rgba(37,40,54,0.50)",
    badgeBorder: "1px solid rgba(47,51,69,0.40)",
    badgeShadow:
      "6px 6px 12px rgba(20,21,27,0.36), -6px -6px 12px rgba(47,51,69,0.16)",
    sparklesIcon: "#98A6C8",
    hashIcon: "#98A6C8",
    calendarIcon: "#98A6C8",
    qrBg: "rgba(37,40,54,0.60)",
    qrBorder: "1px solid rgba(47,51,69,0.50)",
    qrShadow:
      "10px 10px 22px rgba(20,21,27,0.45), -10px -10px 22px rgba(47,51,69,0.2)",
    qrIconColor: "#E6EEF9",
    ambientTop: "rgba(47,51,69,0.30)",
    ambientBottom: "rgba(20,21,27,0.40)",
    hoverGlow:
      "inset 0 0 40px rgba(255,255,255,0.05), inset 0 0 80px rgba(47,51,69,0.4)",
    grainColor: "rgba(255,255,255,0.08)",
    focusRingColor: "#7AA2FF",
    focusRingOffset: "#1E2028",
  },
  pastel: {
    cardBg:
      "linear-gradient(145deg, rgba(255,255,255,0.94), rgba(243,238,232,0.72))",
    cardBorder: "1px solid rgba(255,255,255,0.80)",
    cardShadow:
      "5px 5px 10px rgba(200,193,184,0.45), -5px -5px 16px rgba(255,255,255,0.55)",
    textPrimary: "#101217",
    textSecondary: "#6D7481",
    badgeText: "#5A6270",
    badgeBg: "rgba(255,255,255,0.55)",
    badgeBorder: "1px solid rgba(255,255,255,0.80)",
    badgeShadow:
      "6px 6px 12px rgba(200,193,184,0.22), -6px -6px 12px rgba(255,255,255,0.9)",
    sparklesIcon: "#8D8276",
    hashIcon: "#8D8276",
    calendarIcon: "#8D8276",
    qrBg: "rgba(255,255,255,0.70)",
    qrBorder: "1px solid rgba(255,255,255,0.80)",
    qrShadow:
      "10px 10px 22px rgba(200,193,184,0.32), -10px -10px 22px rgba(255,255,255,0.95)",
    qrIconColor: "#5A6270",
    ambientTop: "rgba(255,255,255,0.60)",
    ambientBottom: "rgba(200,193,184,0.40)",
    hoverGlow:
      "inset 0 0 40px rgba(255,255,255,0.8), inset 0 0 80px rgba(200,193,184,0.35)",
    grainColor: "rgba(0,0,0,0.25)",
    focusRingColor: "#C8C1B8",
    focusRingOffset: "#F8F4F0",
  },
} as const;

export type OgNeumorphicTheme = keyof typeof THEMES;

interface OgNeumorphicProps extends BizCardDetails {
  props: BizCardDetails['props'] & {
    theme?: OgNeumorphicTheme;   // override the generic string with the strict union
  };
}

/* ------------------------------------------------------------------
   Component
------------------------------------------------------------------ */
export default function OgNeumorphic({ props }: OgNeumorphicProps) {
  const { cardName, serialID, dateMade, qrCode, theme = 'pastel', onSideNav = false } = props;
  const C = THEMES[theme] ?? THEMES['pastel'];
  const shell = getCardSideNavClasses(onSideNav);

  // Resolve QR display – use custom node, URL image, or default icon
  const renderQr = () => {
    if (qrCode) return qrCode;
    if (typeof qrCode === "string") {
      return (
        <img
          src={qrCode}
          alt="QR Code"
          className="h-24 w-24 transition-all duration-300 group-hover:scale-105"
        />
      );
    }
    return (
      <QrCodeIcon
        className="h-24 w-24 transition-all duration-300 group-hover:scale-105"
        style={{ color: C.qrIconColor }}
      />
    );
  };

  return (
    <div className={`${shell.outer} group`}>
      <CardTextWrapStyle />
      {/* Group wrapper to enable group‑hover effects */}
      <div className={`${shell.group} ${props.isActive && "ring-2 ring-offset-2 outline-none"}`}
              style={
                {
                  "--tw-ring-color": C.focusRingOffset,
                  "--tw-ring-offset-color": C.focusRingColor,
                } as React.CSSProperties
              }>
        {/* Clickable overlay with dynamic focus ring */}
        <button
          type="button"
          className="absolute inset-0 z-50 rounded-xl bg-transparent cursor-pointer transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2"
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
          className={`${shell.card} transition-all duration-500`}
          style={{
            background: C.cardBg,
            border: C.cardBorder,
            boxShadow: C.cardShadow,
            backdropFilter: "blur(2xl)",
          }}
        >
          {/* ambient glow top-right */}
          <div
            className="pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full blur-[80px]"
            style={{ background: C.ambientTop }}
          />

          {/* ambient glow bottom-left */}
          <div
            className="pointer-events-none absolute -bottom-20 -left-20 h-64 w-64 rounded-full blur-[90px]"
            style={{ background: C.ambientBottom }}
          />

          {/* grain texture */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage: `radial-gradient(circle at 1px 1px, ${C.grainColor} 1px, transparent 0)`,
              backgroundSize: "18px 18px",
            }}
          />

          {/* hover glow */}
          <div
            className="absolute inset-0 rounded-[24px] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
            style={{ boxShadow: C.hoverGlow }}
          />

          <div className={shell.content}>
            <div className={shell.grid}>
              {/* LEFT SECTION */}
              <div className={shell.leftCol}>
                <div>
                  {/* Badge */}
                  <div
                    className={`mb-3 inline-flex items-center rounded-full uppercase tracking-[0.22em] font-semibold backdrop-blur-xl ${shell.badge}`}
                    style={{
                      background: C.badgeBg,
                      border: C.badgeBorder,
                      boxShadow: C.badgeShadow,
                      color: C.badgeText,
                    }}
                  >
                    <Sparkles
                      className={`${shell.sparkles} transition-transform duration-300 group-hover:rotate-12`}
                      style={{ color: C.sparklesIcon }}
                    />
                    Warm Pastel
                  </div>

                  {/* Card Name */}
                  <h1
                    className={`${shell.title} font-semibold tracking-tight`}
                    style={{ color: C.textPrimary }}
                  >
                    {cardName}
                  </h1>
                </div>

                {/* Serial ID */}
                <div className={shell.serialRow}>
                  <div
                    className="flex items-center gap-2 uppercase tracking-[0.18em] text-[0.5rem]"
                    style={{ color: C.textSecondary }}
                  >
                    <Hash className={shell.hash} style={{ color: C.hashIcon }} />
                    <p
                      className={`${shell.serial} font-medium tracking-widest break-all`}
                      style={{ color: C.textPrimary }}
                    >
                      {serialID}
                    </p>
                  </div>
                  {onSideNav && (
                    <div
                      className="flex items-center gap-2 text-[0.5rem] uppercase tracking-[0.18em]"
                      style={{ color: C.textSecondary }}
                    >
                      <CalendarDays
                        className={`${shell.calendar} transition-transform duration-300 group-hover:rotate-12`}
                        style={{ color: C.calendarIcon }}
                      />
                      <p
                        className={`${shell.date} font-medium`}
                        style={{ color: C.textPrimary }}
                      >
                        {dateMade}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT SECTION */}
              {!onSideNav && (
              <div className="col-span-2 flex flex-col justify-between items-end">
                {/* QR Container */}
                <div className="w-full flex justify-center">
                  <div
                    className="relative p-2 rounded-[18px] backdrop-blur-xl transition-all duration-300 group-hover:shadow-none"
                    style={{
                      background: C.qrBg,
                      border: C.qrBorder,
                      boxShadow: C.qrShadow,
                    }}
                  >
                    {renderQr()}
                  </div>
                </div>

                {/* Date */}
                <div
                  className="flex items-center gap-2 text-[0.5rem] uppercase tracking-[0.18em]"
                  style={{ color: C.textSecondary }}
                >
                  <CalendarDays
                    className={`${shell.calendar} transition-transform duration-300 group-hover:rotate-12`}
                    style={{ color: C.calendarIcon }}
                  />
                  <p
                    className={`${shell.date} font-medium`}
                    style={{ color: C.textPrimary }}
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
