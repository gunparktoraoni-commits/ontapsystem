// components/RoyalPurple.tsx
import React from 'react';
import { Sparkles, Hash, QrCode as QrCodeIcon, CalendarDays } from 'lucide-react';
import { BizCardDetails, getCardSideNavClasses, CardTextWrapStyle } from './types';

/* ------------------------------------------------------------------
   Theme palettes – based on the three portfolio templates
   (RoyalPurple, RoyalPurpleV2, RoyalPurpleV3)
------------------------------------------------------------------ */
const THEMES = {
  purple: {
    // Card container
    cardBg: 'linear-gradient(180deg, #11071f 0%, #07020f 100%)',
    cardBorder: '1px solid rgba(241,184,45,0.15)',
    cardShadow: '0 5px 25px rgba(0,0,0,0.55)',
    // Text
    textPrimary: '#fdfaff',
    textSecondary: 'rgba(215,200,245,0.8)',
    // Badge
    badgeBg: 'rgba(241,184,45,0.08)',
    badgeBorder: '1px solid rgba(241,184,45,0.18)',
    badgeText: '#fdfaff',
    // Icons
    sparklesIcon: '#f1b82d',   // gold
    hashIcon: '#c084fc',       // accent
    calendarIcon: '#c084fc',   // accent
    // QR code and frame
    qrIconColor: '#f1b82d',    // gold
    qrFrameGradient: 'linear-gradient(135deg, #f1b82d, #c084fc, #f1b82d)',
    qrInnerBg: '#11071f',      // surface
    // Glows
    innerGlow: 'inset 0 0 24px rgba(192,132,252,0.18)',     // accent with opacity
    ambientPurple: 'rgba(192,132,252,0.12)',
    ambientGold: 'rgba(241,184,45,0.10)',
    // Diamond accent
    diamondBorder: '1px solid rgba(241,184,45,0.08)',
    // Bottom accent line
    bottomAccentGrad: 'linear-gradient(90deg, transparent, #f1b82d, #c084fc, transparent)',
    // Focus ring
    focusRingColor: '#c084fc',
    focusRingOffset: '#07020f',
  },
  teal: {
    cardBg: 'linear-gradient(180deg, #0f1e1c 0%, #07100f 100%)',
    cardBorder: '1px solid rgba(45,210,190,0.15)',
    cardShadow: '0 5px 25px rgba(0,0,0,0.55)',
    textPrimary: '#f0fdfb',
    textSecondary: 'rgba(180,230,225,0.7)',
    badgeBg: 'rgba(94,234,212,0.08)',
    badgeBorder: '1px solid rgba(94,234,212,0.18)',
    badgeText: '#f0fdfb',
    sparklesIcon: '#5eead4',
    hashIcon: '#34d8c0',
    calendarIcon: '#34d8c0',
    qrIconColor: '#5eead4',
    qrFrameGradient: 'linear-gradient(135deg, #5eead4, #34d8c0, #5eead4)',
    qrInnerBg: '#0f1e1c',
    innerGlow: 'inset 0 0 24px rgba(52,216,192,0.18)',
    ambientPurple: 'rgba(52,216,192,0.12)',
    ambientGold: 'rgba(94,234,212,0.10)',
    diamondBorder: '1px solid rgba(94,234,212,0.08)',
    bottomAccentGrad: 'linear-gradient(90deg, transparent, #5eead4, #34d8c0, transparent)',
    focusRingColor: '#34d8c0',
    focusRingOffset: '#07100f',
  },
  amber: {
    cardBg: 'linear-gradient(180deg, #1e1208 0%, #100a07 100%)',
    cardBorder: '1px solid rgba(240,140,41,0.15)',
    cardShadow: '0 5px 25px rgba(0,0,0,0.55)',
    textPrimary: '#fdfaf5',
    textSecondary: 'rgba(245,215,180,0.7)',
    badgeBg: 'rgba(251,191,36,0.08)',
    badgeBorder: '1px solid rgba(251,191,36,0.18)',
    badgeText: '#fdfaf5',
    sparklesIcon: '#fbbf24',
    hashIcon: '#f59e0b',
    calendarIcon: '#f59e0b',
    qrIconColor: '#fbbf24',
    qrFrameGradient: 'linear-gradient(135deg, #fbbf24, #f59e0b, #fbbf24)',
    qrInnerBg: '#1e1208',
    innerGlow: 'inset 0 0 24px rgba(245,158,11,0.18)',
    ambientPurple: 'rgba(245,158,11,0.12)',
    ambientGold: 'rgba(251,191,36,0.10)',
    diamondBorder: '1px solid rgba(251,191,36,0.08)',
    bottomAccentGrad: 'linear-gradient(90deg, transparent, #fbbf24, #f59e0b, transparent)',
    focusRingColor: '#f59e0b',
    focusRingOffset: '#100a07',
  },
} as const;

export type RoyalPurpleTheme = keyof typeof THEMES;

interface RoyalPurpleProps extends BizCardDetails {
  props: BizCardDetails['props'] & {
    theme?: RoyalPurpleTheme;   // override the generic string with the strict union
  };
}

/* ------------------------------------------------------------------
   Component
------------------------------------------------------------------ */
export default function RoyalPurple({ props }: RoyalPurpleProps) {
  const { cardName, serialID, dateMade, qrCode, theme = 'purple', onSideNav = false } = props;
  const C = THEMES[theme] ?? THEMES['purple'];
  const shell = getCardSideNavClasses(onSideNav);

  // Resolve QR display – use custom node, URL image, or default icon
  const renderQr = () => {
    if (qrCode) return qrCode;
    if (typeof qrCode === 'string') {
      return (
        <img
          src={qrCode}
          alt="QR Code"
          className="h-24 w-24 transition-all duration-300 group-hover:scale-110"
        />
      );
    }
    return (
      <QrCodeIcon
        className="h-24 w-24 transition-all duration-300 group-hover:scale-110"
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
          className={`${shell.card} shadow-2xl transition-all duration-300 ease-out`}
          style={{
            background: C.cardBg,
            border: C.cardBorder,
            boxShadow: C.cardShadow,
          }}
        >
          {/* Inner Glow */}
          <div
            className={`${shell.glow} opacity-0 transition-opacity duration-300 group-hover:opacity-100`}
            style={{ boxShadow: C.innerGlow }}
          />

          {/* Purple Ambient */}
          <div
            className="pointer-events-none absolute -top-20 -right-16 h-64 w-64 rounded-full blur-3xl transition-all duration-500"
            style={{ background: C.ambientPurple }}
          />

          {/* Gold Ambient */}
          <div
            className="pointer-events-none absolute -bottom-24 -left-20 h-72 w-72 rounded-full blur-3xl transition-all duration-500"
            style={{ background: C.ambientGold }}
          />

          {/* Luxury Diamond Accent */}
          <div
            className="absolute right-4 top-4 h-16 w-16 rotate-45 rounded-md"
            style={{ border: C.diamondBorder }}
          />

          {/* Grain Texture */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage:
                'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.22) 1px, transparent 0)',
              backgroundSize: '18px 18px',
            }}
          />

          {/* Main content */}
          <div className={shell.content}>
            <div className={shell.grid}>
              {/* LEFT SIDE */}
              <div className={shell.leftCol}>
                <div>
                  {/* Royal Badge */}
                  <div
                    className={`mb-3 inline-flex items-center rounded-full font-semibold uppercase tracking-[0.18em] transition-all duration-300 ${shell.badge}`}
                    style={{
                      background: C.badgeBg,
                      border: C.badgeBorder,
                      color: C.badgeText,
                    }}
                  >
                    <Sparkles
                      className={`${shell.sparkles} transition-transform duration-300 group-hover:rotate-12`}
                      style={{ color: C.sparklesIcon }}
                    />
                    Royal Purple
                  </div>

                  {/* Card Name */}
                  <h1
                    className={`${shell.title} font-semibold tracking-tight`}
                    style={{ color: C.textPrimary }}
                  >
                    {cardName}
                  </h1>
                </div>

                {/* Serial ID row */}
                <div className={shell.serialRow}>
                  <div
                    className="flex items-center gap-1 uppercase tracking-[0.18em]"
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
                      className="flex items-center gap-2 text-[0.5rem] font-semibold uppercase tracking-[0.18em]"
                      style={{ color: C.textSecondary }}
                    >
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
              <div className="col-span-2 flex flex-col justify-between items-end">
                {/* QR SECTION */}
                <div className="flex w-full items-center justify-center">
                  <div className="relative">
                    {/* Gold/Purple Frame */}
                    <div
                      className="rounded-xl p-[2px]"
                      style={{ background: C.qrFrameGradient }}
                    >
                      <div
                        className="rounded-[10px] p-1"
                        style={{ background: C.qrInnerBg }}
                      >
                        {renderQr()}
                      </div>
                    </div>
                  </div>
                </div>

                {/* DATE */}
                <div
                  className="flex items-center gap-2 text-[0.5rem] font-semibold uppercase tracking-[0.18em]"
                  style={{ color: C.textSecondary }}
                >
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

          {/* Premium Bottom Accent */}
          <div
            className="absolute bottom-0 left-0 h-[2px] w-full"
            style={{ background: C.bottomAccentGrad }}
          />
        </div>
      </div>
    </div>
  );
}