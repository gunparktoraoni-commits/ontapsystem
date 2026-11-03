'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { usePortfolioTheme } from './PortfolioThemeContext';
import {
  resolvePortfolioConnectTheme,
  type PortfolioConnectTheme,
} from './portfolioConnectTheme';

/**
 * FloatingContactWidget sits at `bottom-6 right-6` with a `h-14 w-14` FAB.
 * Keep this dock on the same baseline, clear of that circle (+ gap).
 */
const FAB_RIGHT = '1.5rem';
const FAB_SIZE = '3.5rem';
const FAB_GAP = '0.75rem';
const DOCK_RIGHT = `calc(${FAB_RIGHT} + ${FAB_SIZE} + ${FAB_GAP} + env(safe-area-inset-right, 0px))`;
const DOCK_BOTTOM = `calc(1.5rem + env(safe-area-inset-bottom, 0px))`;
const DOCK_LEFT = `calc(1rem + env(safe-area-inset-left, 0px))`;

type PortfolioPromptDockButtonProps = {
  label: string;
  themeId?: string | null;
  theme?: Partial<PortfolioConnectTheme>;
  accent?: string;
  onClick: () => void;
  onDismiss?: () => void;
};

/**
 * Mobile-only bottom prompt aligned with FloatingContactWidget (bottom-right FAB).
 * Pill-shaped, text-only — theme tokens match connect / lead modals.
 */
export default function PortfolioPromptDockButton({
  label,
  themeId,
  theme: themeOverride,
  accent: accentOverride,
  onClick,
  onDismiss,
}: PortfolioPromptDockButtonProps) {
  const [mounted, setMounted] = useState(false);
  const chrome = usePortfolioTheme();

  const resolved = useMemo(
    () =>
      resolvePortfolioConnectTheme(themeId ?? chrome?.themeId, {
        ...chrome?.theme,
        ...themeOverride,
        ...(accentOverride ? { accent: accentOverride } : {}),
      }),
    [accentOverride, chrome?.theme, chrome?.themeId, themeId, themeOverride],
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="pointer-events-none fixed z-9990 flex justify-start sm:hidden"
      style={{
        bottom: DOCK_BOTTOM,
        left: DOCK_LEFT,
        right: DOCK_RIGHT,
        animation: 'portfolioPromptDockIn 0.35s cubic-bezier(0.34,1.2,0.64,1) both',
      }}
    >
      <div
        className="pointer-events-auto inline-flex max-w-full items-center gap-1 rounded-full border py-1.5 pl-4 pr-1.5 shadow-lg"
        style={{
          background: resolved.surface,
          borderColor: resolved.border,
          boxShadow: resolved.shadow ?? '0 12px 28px rgba(0,0,0,0.16)',
          backdropFilter: resolved.backdropFilter,
          WebkitBackdropFilter: resolved.backdropFilter,
          fontFamily: resolved.fontFamily,
        }}
      >
        <button
          type="button"
          onClick={onClick}
          className="min-w-0 truncate py-1.5 text-left text-sm font-semibold leading-none active:opacity-80 transition-opacity"
          style={{ color: resolved.text }}
        >
          {label}
        </button>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss prompt"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition active:scale-95"
            style={{
              color: resolved.muted,
              background: resolved.accentSoft ?? `${resolved.accent}14`,
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <style>{`
        @keyframes portfolioPromptDockIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>,
    document.body,
  );
}
