// components/SimpleClassico.tsx
import React from 'react';
import { Sparkles, Hash, QrCode as QrCodeIcon, CalendarDays } from 'lucide-react';
import { BizCardDetails, getCardSideNavClasses, CardTextWrapStyle } from './types';

/* ------------------------------------------------------------------
   Theme definitions – based on the three portfolio templates
   (BlueRed, GreenGold, HotOrange)
------------------------------------------------------------------ */
const THEMES = {
  'blue-red': {
    // Card container
    cardBg: 'linear-gradient(135deg, #ffffff 0%, #f0f7ff 55%, #fff5f5 100%)',
    cardBorder: 'border-slate-200',
    cardShadow: '0 5px 20px rgba(15,23,42,0.12)',
    // Text
    textPrimary: 'text-slate-900',
    textSecondary: 'text-slate-500',
    accent: '#3b82f6',      // blue-500
    // Badge
    badgeBg: '#eff6ff',      // blue-50
    badgeBorder: '#bfdbfe',  // blue-200
    badgeText: '#1e40af',    // blue-800
    // Icons (Hash, Calendar, Sparkles)
    iconPrimary: '#3b82f6',  // blue-500
    iconSecondary: '#ef4444',// red-500 (for calendar)
    // QR container
    qrBg: 'white',
    qrBorder: 'border-slate-200',
    qrShadow: '0 10px 30px rgba(15,23,42,0.08)',
    qrRadialBg: 'rgba(59,130,246,0.08)',
    // Glow orbs
    glowTop: 'bg-blue-400/15',
    glowBottom: 'bg-red-400/15',
    // Decorative mesh circles
    meshBorder: 'border-blue-200/60',
    meshBorderSecondary: 'border-red-200/60',
    // Bottom accent line gradient
    bottomAccentGradient: 'linear-gradient(90deg, #3b82f6, #ef4444)',
    // Focus ring (for the overlay button)
    focusRingColor: '#fef08a',    // amber-200
    focusRingOffset: '#3b82f6',   // blue-500
  },
  'green-gold': {
    cardBg: 'linear-gradient(135deg, #ffffff 0%, #f0fdfa 55%, #fffbeb 100%)',
    cardBorder: 'border-slate-200',
    cardShadow: '0 5px 20px rgba(15,23,42,0.12)',
    textPrimary: 'text-slate-900',
    textSecondary: 'text-slate-500',
    accent: '#0d9488',      // teal-600
    badgeBg: '#f0fdfa',      // teal-50
    badgeBorder: '#99f6e4',  // teal-200
    badgeText: '#115e59',    // teal-800
    iconPrimary: '#0d9488',  // teal-600
    iconSecondary: '#f59e0b',// amber-500
    qrBg: 'white',
    qrBorder: 'border-slate-200',
    qrShadow: '0 10px 30px rgba(15,23,42,0.08)',
    qrRadialBg: 'rgba(13,148,136,0.08)',
    glowTop: 'bg-teal-400/15',
    glowBottom: 'bg-amber-300/15',
    meshBorder: 'border-teal-200/60',
    meshBorderSecondary: 'border-amber-200/60',
    bottomAccentGradient: 'linear-gradient(90deg, #0d9488, #f59e0b)',
    focusRingColor: '#fef3c7',   // amber-100
    focusRingOffset: '#0d9488',   // teal-600
  },
  'hot-orange': {
    cardBg: 'linear-gradient(135deg, #ffffff 0%, #fff3e8 55%, #fff1f2 100%)',
    cardBorder: 'border-stone-200',
    cardShadow: '0 5px 20px rgba(15,23,42,0.12)',
    textPrimary: 'text-slate-900',
    textSecondary: 'text-slate-500',
    accent: '#f97316',      // orange-500
    badgeBg: '#fff7ed',      // orange-50
    badgeBorder: '#fed7aa',  // orange-200
    badgeText: '#9a3412',    // orange-800
    iconPrimary: '#f97316',  // orange-500
    iconSecondary: '#ef4444',// red-500
    qrBg: 'white',
    qrBorder: 'border-stone-200',
    qrShadow: '0 10px 30px rgba(15,23,42,0.08)',
    qrRadialBg: 'rgba(249,115,22,0.08)',
    glowTop: 'bg-orange-400/15',
    glowBottom: 'bg-stone-300/15',
    meshBorder: 'border-orange-200/60',
    meshBorderSecondary: 'border-stone-200/60',
    bottomAccentGradient: 'linear-gradient(90deg, #f97316, #ef4444)',
    focusRingColor: '#fed7aa',   // orange-200
    focusRingOffset: '#f97316',   // orange-500
  },
} as const;

export type SimpleClassicoTheme = keyof typeof THEMES;

interface SimpleClassicoProps extends BizCardDetails {
  props: BizCardDetails['props'] & {
    theme?: SimpleClassicoTheme;   // override the generic string with the strict union
  };
}

/* ------------------------------------------------------------------
   Component
------------------------------------------------------------------ */
export default function SimpleClassico({ props }: SimpleClassicoProps) {
  const { cardName, serialID, dateMade, qrCode, theme = 'green-gold', onSideNav = false } = props;
  const C = THEMES[theme] ?? THEMES['green-gold'];
  const shell = getCardSideNavClasses(onSideNav);

  // Resolve QR display – use custom node, URL image, or default icon
  const renderQr = () => {
    if (qrCode) return qrCode;
    if (typeof qrCode === 'string') {
      return (
        <img
          src={qrCode}
          alt="QR Code"
          className="relative z-10 h-24 w-24 object-contain transition-all duration-300 group-hover:scale-110 group-focus:scale-110"
        />
      );
    }
    return (
      <QrCodeIcon
        className="relative z-10 h-24 w-24 transition-all duration-300 group-hover:scale-110 group-focus:scale-110"
        style={{ color: C.iconPrimary }}
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
                  "--tw-ring-color": C.focusRingColor,
                  "--tw-ring-offset-color": C.focusRingOffset,
                } as React.CSSProperties
              }>
        {/* Clickable overlay with focus ring styled via CSS custom properties */}
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
          className={`${shell.card} ${C.cardBorder} shadow-2xl transition-all duration-300 ease-out`}
          style={{
            background: C.cardBg,
            boxShadow: C.cardShadow,
          }}
        >
          {/* Ambient glow orbs */}
          <div
            className={`pointer-events-none absolute -top-20 -right-16 h-64 w-64 rounded-full blur-3xl ${C.glowTop}`}
          />
          <div
            className={`pointer-events-none absolute -bottom-24 -left-20 h-72 w-72 rounded-full blur-3xl ${C.glowBottom}`}
          />

          {/* Grid pattern */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(15,23,42,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.35) 1px, transparent 1px)',
              backgroundSize: '28px 28px',
            }}
          />

          {/* Decorative circles */}
          <div
            className={`pointer-events-none absolute top-0 right-0 h-36 w-36 rounded-full border ${C.meshBorder}`}
          />
          <div
            className={`pointer-events-none absolute -bottom-8 -left-8 h-44 w-44 rounded-full border ${C.meshBorderSecondary}`}
          />

          {/* Soft highlight overlay */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.6),transparent_40%,transparent)]" />

          {/* Main content */}
          <div className={shell.content}>
            <div className={shell.grid}>
              {/* Left side – name and serial */}
              <div className={shell.leftCol}>
                <div>
                  {/* Badge with sparkle icon */}
                  <div
                    className={`mb-3 inline-flex items-center rounded-full border font-semibold uppercase tracking-[0.18em] transition-all duration-300 group-hover:border-opacity-100 group-focus:border-opacity-100 ${shell.badge}`}
                    style={{
                      backgroundColor: C.badgeBg,
                      borderColor: C.badgeBorder,
                      color: C.badgeText,
                    }}
                  >
                    <Sparkles
                      className={`${shell.sparkles} transition-transform duration-300 group-hover:rotate-12 group-focus:rotate-12`}
                      style={{ color: C.iconPrimary }}
                    />
                    Simple Classico
                  </div>
                  {/* Card name */}
                  <h1 className={`${shell.title} font-semibold tracking-tight ${C.textPrimary}`}>
                    {cardName}
                  </h1>
                </div>

                {/* Serial ID row */}
                <div className={shell.serialRow}>
                  <div className="mb-1 flex items-center gap-1 text-[0.5rem] font-light uppercase tracking-[0.18em] text-slate-500">
                    <Hash className={shell.hash} style={{ color: C.iconPrimary }} />
                    <p
                      className={`${shell.serial} font-mono font-medium tracking-[0.22em] break-all ${C.textPrimary}`}
                    >
                      {serialID}
                    </p>
                  </div>
                  {onSideNav && (
                    <div className="mb-1 flex items-center gap-2 text-[0.5rem] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      <CalendarDays
                        className={`${shell.calendar} transition-transform duration-300 group-hover:rotate-12 group-focus:rotate-12`}
                        style={{ color: C.iconSecondary }}
                      />
                      <p className={`${shell.date} font-medium ${C.textPrimary}`}>{dateMade}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right side – QR code and date */}
              {!onSideNav && (
              <div className="col-span-2 flex h-full w-full flex-col items-end justify-between">
                <div className="flex w-full items-center justify-center">
                  <div
                    className={`relative flex aspect-square w-full items-center justify-center rounded-xl border shadow-sm ${C.qrBg} ${C.qrBorder}`}
                    style={{ boxShadow: C.qrShadow }}
                  >
                    {/* QR Background Glow */}
                    <div
                      className="absolute inset-0 rounded-xl"
                      style={{
                        background: `radial-gradient(circle at center, ${C.qrRadialBg}, transparent 70%)`,
                      }}
                    />
                    {renderQr()}
                  </div>
                </div>

                <div className="mb-1 flex items-center gap-2 text-[0.5rem] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <CalendarDays
                    className={`${shell.calendar} transition-transform duration-300 group-hover:rotate-12 group-focus:rotate-12`}
                    style={{ color: C.iconSecondary }}
                  />
                  <p className={`${shell.date} font-medium ${C.textPrimary}`}>{dateMade}</p>
                </div>
              </div>
              )}
            </div>
          </div>

          {/* Bottom accent line */}
          <div
            className="absolute bottom-0 left-0 h-[2px] w-full opacity-60"
            style={{ background: C.bottomAccentGradient }}
          />
        </div>
      </div>
    </div>
  );
}