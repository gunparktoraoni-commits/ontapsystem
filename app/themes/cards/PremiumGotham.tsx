// components/PremiumGotham.tsx
import React from 'react';
import { Sparkles, Hash, QrCode as QrCodeIcon, CalendarDays } from 'lucide-react';
import { BizCardDetails, getCardSideNavClasses, CardTextWrapStyle } from './types';

/* ------------------------------------------------------------------
   Theme palettes – based on the three portfolio templates
   (CarbonDiamond, TimelessGold, VoidPurple)
------------------------------------------------------------------ */
const THEMES = {
  'carbon-diamond': {
    // Card container
    cardBg: 'linear-gradient(180deg, #111827 0%, #09090b 100%)',
    cardBorder: '1px solid rgba(255,255,255,0.10)',
    cardShadow: '0 18px 60px rgba(0,0,0,0.45)',
    // Text
    textPrimary: '#f8f3ea',
    textSecondary: '#b4aea4',
    // Badge
    badgeBg: 'rgba(230,247,255,0.10)',
    badgeBorder: '1px solid rgba(230,247,255,0.20)',
    badgeText: '#e6f7ff',
    // Icons
    sparklesIcon: '#e6f7ff',
    hashIcon: '#e6f7ff',
    calendarIcon: '#e6f7ff',
    // QR code
    qrIconColor: '#e6f7ff',
    qrGlowBg: 'rgba(230,247,255,0.15)',
    qrGlowHover: 'rgba(230,247,255,0.25)',
    // Ambient glows
    ambientGold: '#e6f7ff',   // diamond/ice
    ambientSilver: '#c9d6dd',
    // Hover inner glow
    hoverGlow: 'inset 0 0 25px rgba(230,247,255,0.18)',
    // Luxury bottom border
    bottomBorderGrad: 'linear-gradient(90deg, transparent, rgba(230,247,255,0.50), transparent)',
    // Focus ring
    focusRingColor: '#e6f7ff',
    focusRingOffset: '#09090b',
  },
  'timeless-gold': {
    cardBg: 'linear-gradient(180deg, #111827 0%, #09090b 100%)',
    cardBorder: '1px solid rgba(255,255,255,0.10)',
    cardShadow: '0 18px 60px rgba(0,0,0,0.45)',
    textPrimary: '#f8f3ea',
    textSecondary: '#b4aea4',
    badgeBg: 'rgba(214,176,109,0.10)',
    badgeBorder: '1px solid rgba(214,176,109,0.20)',
    badgeText: '#f4efe6',
    sparklesIcon: '#d6b06d',
    hashIcon: '#d6b06d',
    calendarIcon: '#d6b06d',
    qrIconColor: '#d6b06d',
    qrGlowBg: 'rgba(214,176,109,0.15)',
    qrGlowHover: 'rgba(214,176,109,0.25)',
    ambientGold: '#d6b06d',
    ambientSilver: '#b4aea4',
    hoverGlow: 'inset 0 0 25px rgba(214,176,109,0.18)',
    bottomBorderGrad: 'linear-gradient(90deg, transparent, rgba(214,176,109,0.50), transparent)',
    focusRingColor: '#d6b06d',
    focusRingOffset: '#09090b',
  },
  'void-purple': {
    cardBg: 'linear-gradient(180deg, #111827 0%, #09090b 100%)',
    cardBorder: '1px solid rgba(255,255,255,0.10)',
    cardShadow: '0 18px 60px rgba(0,0,0,0.45)',
    textPrimary: '#f5f0ff',
    textSecondary: '#d4c6f7',
    badgeBg: 'rgba(109,40,217,0.10)',
    badgeBorder: '1px solid rgba(109,40,217,0.20)',
    badgeText: '#f5f0ff',
    sparklesIcon: '#6d28d9',
    hashIcon: '#6d28d9',
    calendarIcon: '#6d28d9',
    qrIconColor: '#6d28d9',
    qrGlowBg: 'rgba(109,40,217,0.15)',
    qrGlowHover: 'rgba(109,40,217,0.25)',
    ambientGold: '#6d28d9',
    ambientSilver: '#c9c9d1',
    hoverGlow: 'inset 0 0 25px rgba(109,40,217,0.18)',
    bottomBorderGrad: 'linear-gradient(90deg, transparent, rgba(109,40,217,0.50), transparent)',
    focusRingColor: '#6d28d9',
    focusRingOffset: '#09090b',
  },
} as const;

export type PremiumGothamTheme = keyof typeof THEMES;

interface PremiumGothamProps extends BizCardDetails {
  props: BizCardDetails['props'] & {
    theme?: PremiumGothamTheme;   // override the generic string with the strict union
  };
}

/* ------------------------------------------------------------------
   Component
------------------------------------------------------------------ */
export default function PremiumGotham({ props }: PremiumGothamProps) {
  const { cardName, serialID, dateMade, qrCode, theme = 'timeless-gold', onSideNav = false } = props;
  const C = THEMES[theme] ?? THEMES['timeless-gold'];
  const shell = getCardSideNavClasses(onSideNav);

  // Resolve QR display – use custom node, URL image, or default icon
  const renderQr = () => {
    if (qrCode) return qrCode;
    if (typeof qrCode === 'string') {
      return (
        <img
          src={qrCode}
          alt="QR Code"
          className="relative z-10 h-28 w-28 object-contain transition-all duration-500 group-hover:scale-110 group-focus:scale-110"
        />
      );
    }
    return (
      <QrCodeIcon
        className="relative z-10 h-28 w-28 transition-all duration-500 group-hover:scale-110 group-focus:scale-110"
        style={{ color: C.qrIconColor }}
      />
    );
  };

  return (
    <div className={shell.outer}>
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
          className="absolute h-full w-full z-50 bg-transparent rounded-xl cursor-pointer transition-all duration-300 ease-out hover:shadow-xl focus:shadow-xl focus:outline-none focus:ring-2 focus:ring-offset-2"
          style={
            {
              '--tw-ring-color': C.focusRingOffset,
              '--tw-ring-offset-color': C.focusRingColor,
            } as React.CSSProperties
          }
          aria-label="View card details"
        />

        {/* Card container */}
        <div
          className={`${shell.card} transition-all duration-500 ease-out group-hover:border-opacity-30`}
          style={{
            background: C.cardBg,
            border: C.cardBorder,
            boxShadow: C.cardShadow,
          }}
        >
          {/* Hover Inner Glow */}
          <div
            className={`${shell.glow} opacity-0 transition-opacity duration-500 group-hover:opacity-100`}
            style={{ boxShadow: C.hoverGlow }}
          />

          {/* Gold Ambient Glow */}
          <div
            className="pointer-events-none absolute -top-20 -right-20 h-72 w-72 rounded-full blur-3xl transition-all duration-500 group-hover:opacity-100"
            style={{
              background: `radial-gradient(circle, ${C.ambientGold}20, transparent)`,
            }}
          />

          {/* Silver Ambient Glow */}
          <div
            className="pointer-events-none absolute -bottom-24 -left-20 h-72 w-72 rounded-full blur-3xl transition-all duration-500 group-hover:opacity-100"
            style={{
              background: `radial-gradient(circle, ${C.ambientSilver}20, transparent)`,
            }}
          />

          {/* Luxury Highlight */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: `radial-gradient(circle at top left, ${C.ambientGold}20, transparent 35%),
                           radial-gradient(circle at 80% 20%, rgba(255,255,255,0.03), transparent 25%)`,
            }}
          />

          {/* Metallic Reflection */}
          <div className="pointer-events-none absolute right-0 top-0 h-full w-[40%] bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_60%)]" />

          {/* Premium Grain */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage:
                'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.20) 1px, transparent 0)',
              backgroundSize: '18px 18px',
            }}
          />

          {/* Main content */}
          <div className={shell.content}>
            <div className={shell.grid}>
              {/* LEFT SIDE */}
              <div className={shell.leftCol}>
                <div>
                  {/* Badge with sparkle icon */}
                  <div
                    className={`mb-3 inline-flex items-center rounded-full border font-semibold uppercase tracking-[0.18em] transition-all duration-300 group-hover:border-opacity-40 group-hover:bg-opacity-15 ${shell.badge}`}
                    style={{
                      borderColor: C.badgeBorder,
                      background: C.badgeBg,
                      color: C.badgeText,
                    }}
                  >
                    <Sparkles
                      className={`${shell.sparkles} transition-transform duration-300 group-hover:rotate-12`}
                      style={{ color: C.sparklesIcon }}
                    />
                    Premium Gotham
                  </div>

                  {/* Card name */}
                  <h1
                    className={`${shell.title} font-semibold tracking-tight`}
                    style={{ color: C.textPrimary }}
                  >
                    {cardName}
                  </h1>
                </div>

                {/* Serial ID row */}
                <div className={shell.serialRow}>
                  <div className="mb-1 flex items-center gap-2 text-[0.5rem] uppercase tracking-[0.18em]">
                    <Hash className={shell.hash} style={{ color: C.hashIcon }} />
                    <p
                      className={`${shell.serial} font-medium tracking-widest break-all`}
                      style={{ color: C.textSecondary }}
                    >
                      {serialID}
                    </p>
                  </div>
                  {onSideNav && (
                    <div className="mb-1 flex items-center gap-2 text-[0.5rem] font-semibold uppercase tracking-[0.18em]">
                      <CalendarDays
                        className={`${shell.calendar} transition-transform duration-300 group-hover:rotate-12`}
                        style={{ color: C.calendarIcon }}
                      />
                      <p className={`${shell.date} font-medium`} style={{ color: C.textPrimary }}>
                        {dateMade}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT SIDE */}
              {!onSideNav && (
              <div className="col-span-2 flex h-full flex-col justify-between items-end">
                <div className="flex w-full items-center justify-center">
                  <div className="relative w-full aspect-square flex items-center justify-center">
                    {/* QR Glow */}
                    <div
                      className="absolute h-24 w-24 rounded-full blur-2xl transition-all duration-500"
                      style={{
                        background: C.qrGlowBg,
                        transitionProperty: 'background',
                      }}
                    />
                    {renderQr()}
                  </div>
                </div>

                <div className="mb-1 flex items-center gap-2 text-[0.5rem] font-semibold uppercase tracking-[0.18em]">
                  <CalendarDays
                    className={`${shell.calendar} transition-transform duration-300 group-hover:rotate-12`}
                    style={{ color: C.calendarIcon }}
                  />
                  <p className={`${shell.date} font-medium`} style={{ color: C.textPrimary }}>
                    {dateMade}
                  </p>
                </div>
              </div>
              )}
            </div>
          </div>

          {/* Luxury Bottom Border Glow */}
          <div
            className="pointer-events-none absolute bottom-0 left-0 h-px w-full opacity-60"
            style={{ background: C.bottomBorderGrad }}
          />
        </div>
      </div>
    </div>
  );
}