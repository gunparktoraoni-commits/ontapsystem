// components/OceanGradient.tsx
import React from 'react';
import { Sparkles, Hash, QrCode as QrCodeIcon, CalendarDays } from 'lucide-react';
import { BizCardDetails, getCardSideNavClasses, CardTextWrapStyle } from './types';

/* ------------------------------------------------------------------
   Theme palettes – based on the three portfolio templates
   (OceanGradient, OceanGradientV2, OceanGradientV3)
------------------------------------------------------------------ */
import CspStyle from '@/app/components/CspStyle';
const THEMES = {
  teal: {
    // Card container
    cardBg: 'linear-gradient(180deg, #030810 0%, #061520 50%, #040d18 100%)',
    cardBorder: '1px solid rgba(45,212,184,0.10)',
    cardShadow: '0 5px 20px rgba(0,0,0,0.55), 0 0 25px rgba(45,212,184,0.08)',
    // Text
    textPrimary: '#e8f4f2',
    textSecondary: '#c4ddd8',
    // Badge
    badgeBg: 'rgba(45,212,184,0.10)',
    badgeBorder: '1px solid rgba(45,212,184,0.20)',
    badgeText: '#e8f4f2',
    // Icons
    sparklesIcon: '#2dd4b8',
    hashIcon: '#2dd4b8',
    calendarIcon: '#2dd4b8',
    // QR code
    qrIconColor: '#2dd4b8',
    // Glow orbs
    orbTopLeft: 'radial-gradient(circle, rgba(45,212,184,0.12), transparent 70%)',
    orbBottomRight: 'radial-gradient(circle, rgba(14,116,144,0.12), transparent 70%)',
    orbBottomCenter: 'radial-gradient(circle, rgba(45,212,184,0.12), transparent 70%)',
    // Bioluminescence dots
    dotPrimary: '#2dd4b8',
    dotSecondary: '#a7f3d0',
    // Hover glow
    hoverGlow: 'inset 0 0 25px rgba(45,212,184,0.18)',
    // Focus ring
    focusRingColor: '#2dd4b8',
    focusRingOffset: '#030810',
  },
  green: {
    cardBg: 'linear-gradient(180deg, #0a1209 0%, #0f1e0d 40%, #0a1209 100%)',
    cardBorder: '1px solid rgba(74,222,128,0.10)',
    cardShadow: '0 5px 20px rgba(0,0,0,0.55), 0 0 25px rgba(74,222,128,0.08)',
    textPrimary: '#e8f4ea',
    textSecondary: '#c4d8c8',
    badgeBg: 'rgba(74,222,128,0.10)',
    badgeBorder: '1px solid rgba(74,222,128,0.20)',
    badgeText: '#e8f4ea',
    sparklesIcon: '#4ade80',
    hashIcon: '#4ade80',
    calendarIcon: '#4ade80',
    qrIconColor: '#4ade80',
    orbTopLeft: 'radial-gradient(circle, rgba(74,222,128,0.12), transparent 70%)',
    orbBottomRight: 'radial-gradient(circle, rgba(22,101,52,0.12), transparent 70%)',
    orbBottomCenter: 'radial-gradient(circle, rgba(74,222,128,0.12), transparent 70%)',
    dotPrimary: '#4ade80',
    dotSecondary: '#bbf7d0',
    hoverGlow: 'inset 0 0 25px rgba(74,222,128,0.18)',
    focusRingColor: '#4ade80',
    focusRingOffset: '#0a1209',
  },
  orange: {
    cardBg: 'linear-gradient(180deg, #110508 0%, #1c0a0e 40%, #110508 100%)',
    cardBorder: '1px solid rgba(251,124,80,0.10)',
    cardShadow: '0 5px 20px rgba(0,0,0,0.55), 0 0 25px rgba(251,124,80,0.08)',
    textPrimary: '#f8ede8',
    textSecondary: '#e0c8c0',
    badgeBg: 'rgba(251,124,80,0.10)',
    badgeBorder: '1px solid rgba(251,124,80,0.20)',
    badgeText: '#f8ede8',
    sparklesIcon: '#fb7c50',
    hashIcon: '#fb7c50',
    calendarIcon: '#fb7c50',
    qrIconColor: '#fb7c50',
    orbTopLeft: 'radial-gradient(circle, rgba(251,124,80,0.12), transparent 70%)',
    orbBottomRight: 'radial-gradient(circle, rgba(154,52,18,0.12), transparent 70%)',
    orbBottomCenter: 'radial-gradient(circle, rgba(251,124,80,0.12), transparent 70%)',
    dotPrimary: '#fb7c50',
    dotSecondary: '#fed7aa',
    hoverGlow: 'inset 0 0 25px rgba(251,124,80,0.18)',
    focusRingColor: '#fb7c50',
    focusRingOffset: '#110508',
  },
} as const;

export type OceanGradientTheme = keyof typeof THEMES;

interface OceanGradientProps extends BizCardDetails {
  props: BizCardDetails['props'] & {
    theme?: OceanGradientTheme;   // override the generic string with the strict union
  };
}

/* ------------------------------------------------------------------
   Global keyframes and font imports (identical to portfolio)
------------------------------------------------------------------ */
const KEYFRAMES = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;0,9..144,800;0,9..144,900;1,9..144,400&family=Manrope:wght@300;400;500;600;700;800&display=swap');

@keyframes abyssFloat {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-6px) scale(1.02); }
}
@keyframes biolumPulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.7; }
}

/* Text wrap for headings, paragraphs, and spans */
:is(h1, h2, h3, h4, h5, h6, p, span) {
  overflow-wrap: break-word;
  word-wrap: break-word;
  word-break: normal;
  text-wrap: wrap;
}
`;

export default function OceanGradient({ props }: OceanGradientProps) {
  const { cardName, serialID, dateMade, qrCode, theme = 'teal', onSideNav = false } = props;
  const C = THEMES[theme] ?? THEMES['teal'];
  const shell = getCardSideNavClasses(onSideNav);

  // Resolve QR display – use custom node, URL image, or default icon
  const renderQr = () => {
    if (qrCode) return qrCode;
    if (typeof qrCode === 'string') {
      return (
        <img
          src={qrCode}
          alt="QR Code"
          className="relative h-28 w-28 object-contain transition-all duration-300 group-hover:scale-110 group-focus:scale-110"
        />
      );
    }
    return (
      <QrCodeIcon
        className="relative h-28 w-28 transition-all duration-300 group-hover:scale-110 group-focus:scale-110"
        style={{ color: C.qrIconColor }}
      />
    );
  };

  return (
    <div className={shell.outer}>
      <CardTextWrapStyle />
      {/* Inject keyframes and font imports */}
      <CspStyle dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />

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
          {/* Hover glow effect */}
          <div
            className={`${shell.glow} opacity-0 transition-opacity duration-300 group-hover:opacity-100`}
            style={{ boxShadow: C.hoverGlow }}
          />

          {/* Ambient glowing orbs */}
          <div
            className="pointer-events-none absolute -top-20 -right-20 h-64 w-64 rounded-full blur-3xl transition-all duration-500"
            style={{ background: C.orbTopLeft }}
          />
          <div
            className="pointer-events-none absolute -bottom-24 -left-20 h-72 w-72 rounded-full blur-3xl transition-all duration-500"
            style={{ background: C.orbBottomRight }}
          />

          {/* Floating bioluminescence dots */}
          <div
            className="absolute top-8 right-8 h-3 w-3 rounded-full blur-sm animate-pulse"
            style={{ background: C.dotPrimary, opacity: 0.5 }}
          />
          <div
            className="absolute bottom-10 left-12 h-2 w-2 rounded-full blur-sm animate-pulse"
            style={{ background: C.dotSecondary, opacity: 0.4 }}
          />

          {/* Subtle ocean grain texture */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.18) 1px, transparent 0)',
              backgroundSize: '18px 18px',
            }}
          />

          {/* Main card content */}
          <div className={shell.content}>
            <div className={shell.grid}>
              {/* Left side – name and serial */}
              <div className={shell.leftCol}>
                <div>
                  {/* Badge with sparkle icon */}
                  <div
                    className={`mb-3 inline-flex items-center rounded-full border font-semibold tracking-[0.18em] uppercase transition-all duration-300 group-hover:border-opacity-100 group-focus:border-opacity-100 ${shell.badge}`}
                    style={{
                      borderColor: C.badgeBorder,
                      background: C.badgeBg,
                      color: C.badgeText,
                    }}
                  >
                    <Sparkles
                      className={`${shell.sparkles} transition-transform duration-300 group-hover:rotate-12 group-focus:rotate-12`}
                      style={{ color: C.sparklesIcon }}
                    />
                    Ocean Gradient
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
                  <div className="mb-1 flex items-center gap-1 font-light uppercase tracking-[0.18em] text-[0.5rem]">
                    <Hash
                      className={shell.hash}
                      style={{ color: C.hashIcon }}
                    />
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
                        className={`${shell.calendar} transition-transform duration-300 group-hover:rotate-12 group-focus:rotate-12`}
                        style={{ color: C.calendarIcon }}
                      />
                      <p className={`${shell.date} font-medium`} style={{ color: C.textSecondary }}>
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
                  <div className="relative">
                    {/* QR glow effect */}
                    <div
                      className="absolute inset-0 rounded-full blur-2xl scale-110"
                      style={{ background: `${C.qrIconColor}20` }}
                    />
                    {renderQr()}
                  </div>
                </div>

                <div className="mb-1 flex items-center gap-2 text-[0.5rem] font-semibold uppercase tracking-[0.18em]">
                  <CalendarDays
                    className={`${shell.calendar} transition-transform duration-300 group-hover:rotate-12 group-focus:rotate-12`}
                    style={{ color: C.calendarIcon }}
                  />
                  <p className={`${shell.date} font-medium`} style={{ color: C.textSecondary }}>
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