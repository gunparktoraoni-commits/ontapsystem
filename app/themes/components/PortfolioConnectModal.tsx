'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, LogIn, UserRoundPlus, X } from 'lucide-react';
import { usePortfolioTheme } from './PortfolioThemeContext';
import {
  portfolioChromeCloseButtonStyle,
  portfolioChromePrimaryButtonStyle,
  portfolioChromeRadius,
  portfolioChromeSecondaryButtonStyle,
  resolvePortfolioConnectTheme,
  type PortfolioConnectTheme,
} from './portfolioConnectTheme';

const scheduledPromptPaths = new Set<string>();
const portfolioVisitStartedAt = new Map<string, number>();

export function useDelayedPortfolioConnectPrompt({
  enabled,
  onOpen,
  onMobilePrompt,
  delayMs = 5000,
}: {
  enabled: boolean;
  onOpen: () => void;
  /** When set, mobile viewports show this instead of auto-opening the modal. */
  onMobilePrompt?: () => void;
  delayMs?: number;
}) {
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onMobilePromptRef = useRef(onMobilePrompt);
  onMobilePromptRef.current = onMobilePrompt;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const path = `${window.location.pathname}${window.location.search}`;
    const visitStartedAt = portfolioVisitStartedAt.get(path) ?? Date.now();
    portfolioVisitStartedAt.set(path, visitStartedAt);
    if (!enabled) return;
    if (scheduledPromptPaths.has(path)) return;

    scheduledPromptPaths.add(path);
    let fired = false;
    const remainingDelay = Math.max(0, delayMs - (Date.now() - visitStartedAt));
    const timer = window.setTimeout(() => {
      fired = true;
      const isMobile = window.matchMedia('(max-width: 639px)').matches;
      if (isMobile && onMobilePromptRef.current) {
        onMobilePromptRef.current();
      } else {
        onOpenRef.current();
      }
    }, remainingDelay);

    return () => {
      window.clearTimeout(timer);
      if (!fired) scheduledPromptPaths.delete(path);
    };
  }, [delayMs, enabled]);
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

type PortfolioConnectModalProps = {
  open: boolean;
  isAuthenticated: boolean;
  ownerName?: string;
  ownerTitle?: string;
  ownerImage?: string | null;
  accent?: string;
  theme?: Partial<PortfolioConnectTheme>;
  themeId?: string | null;
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export default function PortfolioConnectModal({
  open,
  isAuthenticated,
  ownerName,
  ownerTitle,
  ownerImage,
  accent,
  theme: themeOverride,
  themeId,
  loading = false,
  onClose,
  onConfirm,
}: PortfolioConnectModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const chrome = usePortfolioTheme();

  const resolved = useMemo(
    () =>
      resolvePortfolioConnectTheme(themeId ?? chrome?.themeId, {
        ...chrome?.theme,
        ...themeOverride,
        ...(accent ? { accent } : {}),
      }),
    [accent, chrome?.theme, chrome?.themeId, themeId, themeOverride],
  );

  const name = ownerName?.trim() || chrome?.ownerName || 'this portfolio owner';
  const title = ownerTitle?.trim() || chrome?.ownerTitle || '';
  const image = ownerImage ?? chrome?.ownerImage ?? null;
  const radius = portfolioChromeRadius(resolved);
  const closeStyle = portfolioChromeCloseButtonStyle(resolved);
  const secondaryBtn = portfolioChromeSecondaryButtonStyle(resolved);
  const primaryBtn = portfolioChromePrimaryButtonStyle(resolved);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [loading, onClose, open]);

  if (!open) return null;

  const returnPath =
    typeof window === 'undefined'
      ? '/'
      : `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const loginHref = `/?redirect=${encodeURIComponent(returnPath)}`;
  const signupHref = `/user/signup?redirect=${encodeURIComponent(returnPath)}`;

  return createPortal(
    <div
      className="fixed inset-0 z-100000 flex items-end justify-center p-0 sm:items-center sm:p-5"
      role="presentation"
      style={{
        background: resolved.overlay,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="portfolio-connect-title"
        tabIndex={-1}
        className="relative w-full max-w-md overflow-hidden outline-none rounded-t-[var(--connect-radius)] sm:max-w-105 sm:rounded-[var(--connect-radius)]"
        style={{
          ['--connect-radius' as string]: radius,
          background: resolved.surface,
          border: `1px solid ${resolved.border}`,
          boxShadow: resolved.shadow ?? '0 28px 70px rgba(0,0,0,0.28)',
          backdropFilter: resolved.backdropFilter,
          WebkitBackdropFilter: resolved.backdropFilter,
          fontFamily: resolved.fontFamily,
          color: resolved.text,
        }}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-24"
          style={{
            background: `linear-gradient(180deg, ${resolved.accentSoft ?? `${resolved.accent}22`} 0%, transparent 100%)`,
          }}
        />
        <div
          className="mx-auto mt-3 h-1.5 w-12 rounded-full sm:hidden"
          style={{ background: resolved.divider ?? resolved.border }}
        />

        <div className="relative px-5 pb-5 pt-4 sm:px-6 sm:pb-6 sm:pt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            aria-label="Close connection dialog"
            className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full transition disabled:opacity-50"
            style={closeStyle}
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex flex-col items-center text-center">
            <div
              className="mb-4 flex h-20 w-20 items-center justify-center overflow-hidden rounded-full text-lg font-bold shadow-lg"
              style={{
                background: resolved.accentSoft ?? `${resolved.accent}22`,
                color: resolved.accent,
                boxShadow: `0 0 0 3px ${resolved.surface}, 0 0 0 5px ${resolved.accent}`,
              }}
            >
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="" className="h-full w-full object-cover" />
              ) : (
                initialsFromName(name)
              )}
            </div>

            <p
              className="text-[10px] font-bold uppercase tracking-[0.18em]"
              style={{ color: resolved.accent }}
            >
              Associate request
            </p>
            <h2
              id="portfolio-connect-title"
              className="mt-1.5 text-xl font-bold leading-tight sm:text-[22px]"
              style={{ color: resolved.text }}
            >
              {isAuthenticated ? `Connect with ${name}?` : `Join OnTap to connect`}
            </h2>
            {title ? (
              <p className="mt-1 text-sm" style={{ color: resolved.muted }}>
                {title}
              </p>
            ) : null}
            <p
              className="mt-3 max-w-sm text-sm leading-6"
              style={{ color: resolved.muted }}
            >
              {isAuthenticated
                ? `Send ${name} an associate request. They’ll get a notification and can accept it from their account.`
                : `You need an OnTap account to send ${name} an associate request. Sign in or create one, then you’ll return here.`}
            </p>
          </div>

          {isAuthenticated ? (
            <ul className="mt-5 space-y-2.5">
              {[
                'They review your request first',
                'You’ll be notified if they accept',
                'Accepted associates can stay in touch',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-left text-sm">
                  <span
                    className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: resolved.accentSoft ?? `${resolved.accent}22`,
                      color: resolved.accent,
                    }}
                  >
                    <Check className="h-3 w-3" strokeWidth={2.6} />
                  </span>
                  <span style={{ color: resolved.text }}>{item}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {isAuthenticated ? (
            <div className="mt-6 grid gap-2 sm:grid-cols-[1fr_1.4fr]">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="min-h-12 px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50"
                style={secondaryBtn}
              >
                Not now
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={loading}
                className="inline-flex min-h-12 items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-70"
                style={primaryBtn}
              >
                <UserRoundPlus className="h-4 w-4" />
                {loading ? 'Sending…' : 'Send request'}
                {!loading && <ArrowRight className="h-4 w-4" />}
              </button>
            </div>
          ) : (
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              <a
                href={loginHref}
                className="inline-flex min-h-12 items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold transition"
                style={secondaryBtn}
              >
                <LogIn className="h-4 w-4" />
                Sign in
              </a>
              <a
                href={signupHref}
                className="inline-flex min-h-12 items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold transition"
                style={primaryBtn}
              >
                Create account
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
