// components/ModernMinimalist.tsx
import React from 'react';
import { Sparkles, Hash, QrCode as QrCodeIcon, CalendarDays } from 'lucide-react';
import { BizCardDetails, getCardSideNavClasses, CardTextWrapStyle } from './types';

/* ------------------------------------------------------------------
   Theme definitions – based on the three portfolio templates
   (CharcoalYellow, LightBlue, OceanBlue)
------------------------------------------------------------------ */
const THEMES = {
  'charcoal-yellow': {
    // Card container
    cardBg: 'linear-gradient(180deg, #1C1C1E 0%, #141416 100%)',
    cardBorder: 'border-white/5',
    cardShadow: '0 5px 20px rgba(0,0,0,0.45)',
    // Text
    textPrimary: 'text-zinc-100',
    textSecondary: 'text-zinc-400',
    accent: '#eab308',      // yellow-400
    // Badge
    badgeBg: 'bg-yellow-400/10',
    badgeBorder: 'border-yellow-400/20',
    badgeText: 'text-yellow-400',
    // Icons
    iconColor: '#eab308',
    // QR container
    qrBg: 'bg-zinc-900',
    qrBorder: 'border-zinc-700',
    // Glow orbs
    glowTop: 'bg-yellow-400/15',
    glowBottom: 'bg-amber-500/10',
    // Decorative mesh
    meshBorder: 'border-yellow-400/20',
    meshBorderSecondary: 'border-amber-500/10',
    // Focus ring
    focusRingColor: '#fef08a',   // amber-200
    focusRingOffset: '#1C1C1E',  // dark card background
  },
  'light-blue': {
    cardBg: 'linear-gradient(180deg, #ffffff 0%, #f6fbff 100%)',
    cardBorder: 'border-sky-200/40',
    cardShadow: '0 5px 20px rgba(37,99,235,0.12)',
    textPrimary: 'text-slate-900',
    textSecondary: 'text-slate-500',
    accent: '#0ea5e9',      // sky-500
    badgeBg: 'bg-sky-50',
    badgeBorder: 'border-sky-300',
    badgeText: 'text-sky-700',
    iconColor: '#0ea5e9',
    qrBg: 'bg-white',
    qrBorder: 'border-sky-100',
    glowTop: 'bg-sky-400/15',
    glowBottom: 'bg-blue-500/10',
    meshBorder: 'border-sky-200',
    meshBorderSecondary: 'border-blue-100',
    focusRingColor: '#bae6fd',   // sky-200
    focusRingOffset: '#ffffff',  // white
  },
  'ocean-blue': {
    cardBg: 'linear-gradient(180deg, #0F172A 0%, #0A0F1C 100%)',
    cardBorder: 'border-white/8',
    cardShadow: '0 5px 20px rgba(0,0,0,0.6)',
    textPrimary: 'text-white',
    textSecondary: 'text-slate-400',
    accent: '#38bdf8',      // sky-400
    badgeBg: 'bg-sky-400/10',
    badgeBorder: 'border-sky-400/20',
    badgeText: 'text-sky-300',
    iconColor: '#38bdf8',
    qrBg: 'bg-slate-900',
    qrBorder: 'border-slate-700',
    glowTop: 'bg-sky-400/15',
    glowBottom: 'bg-cyan-500/10',
    meshBorder: 'border-sky-400/20',
    meshBorderSecondary: 'border-cyan-500/10',
    focusRingColor: '#7dd3fc',   // sky-300
    focusRingOffset: '#0F172A',  // slate-900
  },
} as const;

export type ModernMinimalistTheme = keyof typeof THEMES;

interface ModernMinimalistProps extends BizCardDetails {
  props: BizCardDetails['props'] & {
    theme?: ModernMinimalistTheme;   // override the generic string with the strict union
  };
}

/* ------------------------------------------------------------------
   Component
------------------------------------------------------------------ */
export default function ModernMinimalist({ props }: ModernMinimalistProps) {
  const { cardName, serialID, dateMade, qrCode, theme = 'charcoal-yellow', onSideNav = false } = props;
  const C = THEMES[theme] ?? THEMES['charcoal-yellow'];
  const shell = getCardSideNavClasses(onSideNav);

  // Resolve QR display – use custom node, URL image, or default icon
  const renderQr = () => {
    if (qrCode) return qrCode;
    if (typeof qrCode === 'string') {
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
        style={{ color: C.iconColor }}
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
          className={`${shell.card} ${C.cardBorder} shadow-2xl transition-all duration-300 ease-out`}
          style={{
            background: C.cardBg,
            boxShadow: C.cardShadow,
          }}
        >
          {/* Ambient glow orbs */}
          <div
            className="pointer-events-none absolute -top-20 -right-16 h-64 w-64 rounded-full blur-3xl"
            style={{ background: C.glowTop }}
          />
          <div  
            className="pointer-events-none absolute -bottom-24 -left-20 h-72 w-72 rounded-full blur-3xl"
            style={{ background: C.glowBottom }}
          />

          {/* Grain texture */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.12) 1px, transparent 0)',
              backgroundSize: '18px 18px',
            }}
          />

          {/* Decorative mesh circles */}
          <div className="absolute inset-0 opacity-40">
            <div
              className="absolute top-0 right-0 w-40 h-40 rounded-full border"
              style={{ borderColor: C.meshBorder }}
            />
            <div
              className="absolute -bottom-10 -left-10 w-52 h-52 rounded-full border"
              style={{ borderColor: C.meshBorderSecondary }}
            />
          </div>

          {/* Main content */}
          <div className={shell.content}>
            <div className={shell.grid}>
              {/* Left side – name and serial */}
              <div className={shell.leftCol}>
                <div>
                  {/* Badge with sparkle icon */}
                  <div
                    className={`mb-3 inline-flex items-center rounded-full border font-semibold tracking-[0.18em] uppercase transition-all duration-300 group-hover:border-opacity-100 group-focus:border-opacity-100 ${shell.badge} ${C.badgeBg} ${C.badgeBorder} ${C.badgeText}`}
                  >
                    <Sparkles
                      className={`${shell.sparkles} transition-transform duration-300 group-hover:rotate-12 group-focus:rotate-12`}
                      style={{ color: C.iconColor }}
                    />
                    Modern Minimalist
                  </div>
                  {/* Card name */}
                  <h1 className={`${shell.title} font-semibold tracking-tight ${C.textPrimary}`}>
                    {cardName}
                  </h1>
                </div>

                {/* Serial ID row */}
                <div className={shell.serialRow}>
                  <div className="mb-1 flex items-center gap-1 text-[0.5rem] uppercase tracking-[0.18em] text-slate-500">
                    <Hash className={shell.hash} style={{ color: C.iconColor }} />
                    <p className={`${shell.serial} font-medium tracking-widest ${C.textPrimary}`}>
                      {serialID}
                    </p>
                  </div>
                  {onSideNav && (
                    <div className="mb-1 flex items-center gap-2 text-[0.5rem] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      <CalendarDays
                        className={`${shell.calendar} transition-transform duration-300 group-hover:rotate-12 group-focus:rotate-12`}
                        style={{ color: C.iconColor }}
                      />
                      <p className={`${shell.date} font-medium ${C.textPrimary}`}>{dateMade}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right side – QR code and date */}
              {!onSideNav && (
              <div className="col-span-2 flex h-full w-full flex-col justify-between items-end">
                <div className="flex w-full items-center justify-center">
                  <div
                    className={`relative flex aspect-square w-full items-center justify-center rounded-lg border shadow-sm ${C.qrBg} ${C.qrBorder}`}
                  >
                    {renderQr()}
                  </div>
                </div>

                <div className="mb-1 flex items-center gap-2 text-[0.5rem] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <CalendarDays
                    className={`${shell.calendar} transition-transform duration-300 group-hover:rotate-12 group-focus:rotate-12`}
                    style={{ color: C.iconColor }}
                  />
                  <p className={`${shell.date} font-medium ${C.textPrimary}`}>{dateMade}</p>
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