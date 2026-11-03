// components/NouveauRiche.tsx
import React from 'react';
import { Sparkles, Hash, QrCode as QrCodeIcon, CalendarDays } from 'lucide-react';
import { BizCardDetails, getCardSideNavClasses, CardTextWrapStyle } from './types';

/* ------------------------------------------------------------------
   Theme palettes – based on the three portfolio templates
   (BloodRose, MintyGreen, PristineGold)
------------------------------------------------------------------ */
const THEMES = {
  'blood-rose': {
    // Card container
    cardBg: 'linear-gradient(180deg, #100507 0%, #1A0A0C 50%, #0b0304 100%)',
    cardBorder: '1px solid rgba(255,255,255,0.10)',
    cardShadow: '0 5px 20px rgba(0,0,0,0.5)',
    // Text
    textPrimary: '#F7EAF0',
    textSecondary: '#B8929C',
    // Badge
    badgeBg: 'rgba(255,75,120,0.08)',
    badgeBorder: '1px solid rgba(255,75,120,0.25)',
    badgeText: '#F7EAF0',
    // Icons
    sparklesIcon: '#FF4B78',
    hashIcon: '#FF4B78',
    calendarIcon: '#FF4B78',
    // QR code
    qrIconColor: '#FF4B78',
    qrRingBorder: '1px dashed rgba(255,75,120,0.25)',
    // Glows and effects
    innerGlow: 'inset 0 0 25px rgba(255,75,120,0.22)',
    ambientTopRight: 'rgba(255,75,120,0.12)',
    ambientBottomLeft: 'rgba(255,122,158,0.10)',
    roseBeamGrad: 'linear-gradient(to bottom, transparent, #FF4B78, #FF7A9E, #FF4B78, transparent)',
    grainColor: 'rgba(255,255,255,0.22)',
    subtitleColor: '#B8929C',
    // Focus ring
    focusRingColor: '#100507',
    focusRingOffset: '#FF4B78',
  },
  'minty-green': {
    cardBg: 'linear-gradient(180deg, #F7F8F4 0%, #EEF3E7 50%, #F7F8F4 100%)',
    cardBorder: '1px solid rgba(94,126,63,0.15)',
    cardShadow: '0 5px 20px rgba(94,126,63,0.12)',
    textPrimary: '#1E2718',
    textSecondary: '#66715A',
    badgeBg: 'rgba(94,126,63,0.08)',
    badgeBorder: '1px solid rgba(94,126,63,0.25)',
    badgeText: '#1E2718',
    sparklesIcon: '#5E7E3F',
    hashIcon: '#5E7E3F',
    calendarIcon: '#5E7E3F',
    qrIconColor: '#5E7E3F',
    qrRingBorder: '1px dashed rgba(94,126,63,0.25)',
    innerGlow: 'inset 0 0 25px rgba(94,126,63,0.22)',
    ambientTopRight: 'rgba(94,126,63,0.12)',
    ambientBottomLeft: 'rgba(125,157,89,0.10)',
    roseBeamGrad: 'linear-gradient(to bottom, transparent, #5E7E3F, #7D9D59, #5E7E3F, transparent)',
    grainColor: 'rgba(0,0,0,0.12)',
    subtitleColor: '#66715A',
    focusRingColor: '#F7F8F4',
    focusRingOffset: '#5E7E3F',
  },
  'pristine-gold': {
    cardBg: 'linear-gradient(180deg, #0B0A08 0%, #131210 50%, #0B0A08 100%)',
    cardBorder: '1px solid rgba(201,168,76,0.15)',
    cardShadow: '0 5px 20px rgba(0,0,0,0.5)',
    textPrimary: '#F2EBD9',
    textSecondary: '#9A8E7C',
    badgeBg: 'rgba(201,168,76,0.08)',
    badgeBorder: '1px solid rgba(201,168,76,0.25)',
    badgeText: '#F2EBD9',
    sparklesIcon: '#C9A84C',
    hashIcon: '#C9A84C',
    calendarIcon: '#C9A84C',
    qrIconColor: '#C9A84C',
    qrRingBorder: '1px dashed rgba(201,168,76,0.25)',
    innerGlow: 'inset 0 0 25px rgba(201,168,76,0.22)',
    ambientTopRight: 'rgba(201,168,76,0.12)',
    ambientBottomLeft: 'rgba(232,201,122,0.10)',
    roseBeamGrad: 'linear-gradient(to bottom, transparent, #C9A84C, #E8C97A, #C9A84C, transparent)',
    grainColor: 'rgba(255,255,255,0.22)',
    subtitleColor: '#9A8E7C',
    focusRingColor: '#0B0A08',
    focusRingOffset: '#C9A84C',
  },
} as const;

export type NouveauRicheTheme = keyof typeof THEMES;

interface NouveauRicheProps extends BizCardDetails {
  props: BizCardDetails['props'] & {
    theme?: NouveauRicheTheme;   // override the generic string with the strict union
  };
}

/* ------------------------------------------------------------------
   Component
------------------------------------------------------------------ */
export default function NouveauRiche({ props }: NouveauRicheProps) {
  const { cardName, serialID, dateMade, qrCode, theme = 'blood-rose', onSideNav = false } = props;
  const C = THEMES[theme] ?? THEMES['blood-rose'];
  const shell = getCardSideNavClasses(onSideNav);

  // Resolve QR display – use custom node, URL image, or default icon
  const renderQr = () => {
    if (qrCode) return qrCode;
    if (typeof qrCode === 'string') {
      return (
        <img
          src={qrCode}
          alt="QR Code"
          className="h-28 w-28 transition-all duration-300 group-hover:scale-110 z-30"
        />
      );
    }
    return (
      <QrCodeIcon
        className="h-28 w-28 transition-all duration-300 group-hover:scale-110 z-30"
        style={{ color: C.qrIconColor }}
      />
    );
  };

  return (
    <div className={`group ${shell.outer}`}>
      <CardTextWrapStyle />
      {/* Group wrapper to enable group‑hover effects */}
      <div className={`${shell.group} ${props.isActive && "ring-2 ring-offset-2 outline-none"}`}
              style={
                {
                  "--tw-ring-color": C.focusRingColor,
                  "--tw-ring-offset-color": C.focusRingOffset,
                } as React.CSSProperties
              }>
        {/* Clickable overlay with dynamic focus ring */}
        <button
          type="button"
          className="absolute h-full w-full z-50 bg-transparent rounded-xl cursor-pointer transition-all duration-300 ease-out hover:shadow-xl focus:shadow-xl focus:outline-none focus:ring-2 focus:ring-offset-2"
          style={
            {
              '--tw-ring-color': C.focusRingColor,
              '--tw-ring-offset-color': C.focusRingOffset,
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
          {/* Hover Inner Glow */}
          <div
            className={`${shell.glow} opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus:opacity-100`}
            style={{ boxShadow: C.innerGlow }}
          />

          {/* Top Right Ambient Glow */}
          <div
            className="pointer-events-none absolute -top-20 -right-16 h-64 w-64 rounded-full blur-3xl transition-all duration-500"
            style={{ background: C.ambientTopRight }}
          />

          {/* Bottom Left Ambient Glow */}
          <div
            className="pointer-events-none absolute -bottom-24 -left-20 h-72 w-72 rounded-full blur-3xl transition-all duration-500"
            style={{ background: C.ambientBottomLeft }}
          />

          {/* Rose Accent Beam */}
          <div
            className="absolute left-0 top-0 bottom-0 w-[2px]"
            style={{
              background: C.roseBeamGrad,
              opacity: 0.5,
            }}
          />

          {/* Grain Texture */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.08]"
            style={{
              backgroundImage: `radial-gradient(circle at 1px 1px, ${C.grainColor} 1px, transparent 0)`,
              backgroundSize: '18px 18px',
            }}
          />

          {/* Content */}
          <div className={shell.content}>
            <div className={shell.grid}>
              {/* LEFT */}
              <div className={shell.leftCol}>
                <div>
                  {/* Theme Badge */}
                  <div
                    className={`mb-3 inline-flex items-center rounded-full font-semibold uppercase tracking-[0.18em] transition-all duration-300 ${shell.badge}`}
                    style={{
                      border: C.badgeBorder,
                      background: C.badgeBg,
                      color: C.badgeText,
                    }}
                  >
                    <Sparkles
                      className={`${shell.sparkles} transition-transform duration-300 group-hover:rotate-12`}
                      style={{ color: C.sparklesIcon }}
                    />
                    Nouveau Riche
                  </div>

                  {/* Card Name */}
                  <h1
                    className={`${shell.title} font-semibold tracking-tight`}
                    style={{ color: C.textPrimary }}
                  >
                    {cardName}
                  </h1>
                </div>

                {/* Serial */}
                <div className={shell.serialRow}>
                  <div
                    className="flex items-center gap-1 uppercase tracking-[0.18em] text-[0.5rem]"
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

              {/* RIGHT */}
              {!onSideNav && (
              <div className="col-span-2 flex flex-col justify-between items-end">
                {/* QR Section */}
                <div className="flex w-full items-center justify-center">
                  <div className="relative w-full aspect-square flex items-center justify-center">
                    {/* Decorative Ring */}
                    <div
                      className="absolute inset-4 rounded-full z-0"
                      style={{ border: C.qrRingBorder }}
                    />
                    {renderQr()}
                  </div>
                </div>

                {/* Date */}
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
        </div>
      </div>
    </div>
  );
}