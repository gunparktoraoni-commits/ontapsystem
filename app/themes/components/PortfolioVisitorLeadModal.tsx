'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  Handshake,
  Mail,
  Phone,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { usePortfolioTheme } from './PortfolioThemeContext';
import {
  portfolioChromeCloseButtonStyle,
  portfolioChromeErrorStyle,
  portfolioChromeFieldStyle,
  portfolioChromePrimaryButtonStyle,
  portfolioChromeRadius,
  resolvePortfolioConnectTheme,
  type PortfolioConnectTheme,
} from './portfolioConnectTheme';
import { LegalPolicyModal } from '@/app/components/legal/LegalPolicyModal';
import type { LegalPolicyId } from '@/app/lib/legal';

const LEAD_STORAGE_PREFIX = 'ontap_visitor_lead:';

const scheduledLeadPaths = new Set<string>();
const leadVisitStartedAt = new Map<string, number>();

export function hasSubmittedVisitorLead(alias: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(`${LEAD_STORAGE_PREFIX}${alias}`) === '1';
  } catch {
    return false;
  }
}

export function markVisitorLeadSubmitted(alias: string): void {
  try {
    window.localStorage.setItem(`${LEAD_STORAGE_PREFIX}${alias}`, '1');
  } catch {
    // ignore
  }
}

/** Delayed prompt for guest lead capture (once per visit until submitted). */
export function useDelayedPortfolioVisitorLeadPrompt({
  enabled,
  onOpen,
  onMobilePrompt,
  delayMs = 4500,
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
    const visitStartedAt = leadVisitStartedAt.get(path) ?? Date.now();
    leadVisitStartedAt.set(path, visitStartedAt);
    if (!enabled) return;
    if (scheduledLeadPaths.has(path)) return;

    scheduledLeadPaths.add(path);
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
      if (!fired) scheduledLeadPaths.delete(path);
    };
  }, [delayMs, enabled]);
}

type PortfolioVisitorLeadModalProps = {
  open: boolean;
  urlAlias: string;
  ownerName?: string;
  ownerTitle?: string;
  ownerImage?: string | null;
  accent?: string;
  theme?: Partial<PortfolioConnectTheme>;
  themeId?: string | null;
  onClose: () => void;
  onSubmitted?: () => void;
};

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export default function PortfolioVisitorLeadModal({
  open,
  urlAlias,
  ownerName,
  ownerTitle,
  ownerImage,
  accent,
  theme: themeOverride,
  themeId,
  onClose,
  onSubmitted,
}: PortfolioVisitorLeadModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const chrome = usePortfolioTheme();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [policy, setPolicy] = useState<LegalPolicyId | null>(null);

  const resolved = useMemo(
    () =>
      resolvePortfolioConnectTheme(themeId ?? chrome?.themeId, {
        ...chrome?.theme,
        ...themeOverride,
        ...(accent ? { accent } : {}),
      }),
    [accent, chrome?.theme, chrome?.themeId, themeId, themeOverride],
  );

  const displayName = ownerName?.trim() || chrome?.ownerName || 'this professional';
  const firstName = displayName.split(' ')[0] || displayName;
  const title = ownerTitle?.trim() || chrome?.ownerTitle || '';
  const image = ownerImage ?? chrome?.ownerImage ?? null;
  const radius = portfolioChromeRadius(resolved);
  const fieldStyle = portfolioChromeFieldStyle(resolved);
  const errorStyle = portfolioChromeErrorStyle(resolved);
  const primaryBtn = portfolioChromePrimaryButtonStyle(resolved);
  const closeStyle = portfolioChromeCloseButtonStyle(resolved);
  const fieldBg = fieldStyle.background;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) handleDismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, open]);

  function handleDismiss() {
    if (busy) return;
    onClose();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);

    if (name.trim().length < 2) {
      setError('Please enter your full name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    if (phone.replace(/\D/g, '').length < 7) {
      setError('Please enter a valid contact number.');
      return;
    }

    setBusy(true);
    try {
      let visitorId: string | undefined;
      try {
        visitorId = window.localStorage.getItem('ontap_visitor_id')?.trim() || undefined;
      } catch {
        visitorId = undefined;
      }

      const res = await fetch(`/api/portfolio/${encodeURIComponent(urlAlias)}/visitor-lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          visitorId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 || data.code === 'duplicate' || data.alreadySubmitted) {
        markVisitorLeadSubmitted(urlAlias);
        setDone(true);
        onSubmitted?.();
        return;
      }
      if (res.status === 403 && data.code === 'authenticated') {
        setError("You're signed in — use Connect instead of this guest form.");
        onClose();
        return;
      }
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not save your details.');
        return;
      }
      markVisitorLeadSubmitted(urlAlias);
      setDone(true);
      onSubmitted?.();
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-100000 flex items-end justify-center p-0 sm:items-center sm:p-5"
        role="presentation"
        style={{
          background: resolved.overlay,
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) handleDismiss();
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="portfolio-visitor-lead-title"
          tabIndex={-1}
          className="relative max-h-[92vh] w-full max-w-md overflow-y-auto overscroll-contain outline-none rounded-t-[var(--lead-radius)] sm:max-w-100 sm:rounded-[var(--lead-radius)]"
          style={{
            ['--lead-radius' as string]: radius,
            ['--lead-placeholder' as string]: resolved.muted,
            ['--lead-field-bg' as string]: fieldBg,
            ['--lead-field-text' as string]: resolved.text,
            ['--lead-accent-ring' as string]: `${resolved.accent}55`,
            background: resolved.surface,
            border: `1px solid ${resolved.border}`,
            boxShadow: resolved.shadow ?? '0 28px 70px rgba(0,0,0,0.28)',
            backdropFilter: resolved.backdropFilter,
            WebkitBackdropFilter: resolved.backdropFilter,
            fontFamily: resolved.fontFamily,
            color: resolved.text,
          }}
        >
          <style>{`
            .portfolio-lead-field::placeholder {
              color: var(--lead-placeholder);
              opacity: 0.85;
            }
            .portfolio-lead-field:focus {
              outline: none;
              box-shadow: 0 0 0 2px var(--lead-accent-ring);
            }
            .portfolio-lead-field:-webkit-autofill,
            .portfolio-lead-field:-webkit-autofill:hover,
            .portfolio-lead-field:-webkit-autofill:focus {
              -webkit-text-fill-color: var(--lead-field-text);
              transition: background-color 9999s ease-out;
              box-shadow: 0 0 0 1000px var(--lead-field-bg) inset;
            }
          `}</style>
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
              onClick={handleDismiss}
              disabled={busy}
              aria-label="Close"
              className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full transition disabled:opacity-50"
              style={closeStyle}
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex flex-col items-center text-center">
              <div
                className="mb-3 flex h-14 w-14 items-center justify-center overflow-hidden rounded-full text-sm font-bold shadow-lg"
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
                  initialsFromName(displayName)
                )}
              </div>
              <p
                className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.18em]"
                style={{ color: resolved.accent }}
              >
                <Sparkles className="h-3 w-3" />
                Stay connected
              </p>
              <h2
                id="portfolio-visitor-lead-title"
                className="mt-1.5 text-xl font-bold leading-tight"
                style={{ color: resolved.text }}
              >
                {done ? "You're all set!" : `Leave your details for ${firstName}`}
              </h2>
              {title && !done ? (
                <p className="mt-1 text-sm" style={{ color: resolved.muted }}>
                  {title}
                </p>
              ) : null}
              <p className="mt-2 max-w-xs text-sm leading-5" style={{ color: resolved.muted }}>
                {done
                  ? `${firstName} can reach out to you soon.`
                  : 'Name, number, and email — no account needed.'}
              </p>
            </div>

            {done ? (
              <div className="mt-5 space-y-4">
                <div
                  className="flex items-start gap-3 px-4 py-3 text-left text-sm"
                  style={{
                    background: resolved.accentSoft ?? `${resolved.accent}18`,
                    color: resolved.text,
                    borderRadius: radius,
                    border: `1px solid ${resolved.border}`,
                  }}
                >
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" style={{ color: resolved.accent }} />
                  <span>Your contact info was shared with {displayName}.</span>
                </div>
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="inline-flex w-full items-center justify-center gap-2 px-4 py-3 text-sm font-semibold transition hover:opacity-95"
                  style={primaryBtn}
                >
                  Continue browsing
                </button>
              </div>
            ) : (
              <form onSubmit={(e) => void handleSubmit(e)} className="mt-5 space-y-3 text-left" noValidate>
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold" style={{ color: resolved.muted }}>
                    <UserRound className="h-3.5 w-3.5" /> Full name
                  </span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    placeholder="Juan Dela Cruz"
                    className="portfolio-lead-field w-full px-3.5 py-2.5 text-sm transition"
                    style={fieldStyle}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold" style={{ color: resolved.muted }}>
                    <Phone className="h-3.5 w-3.5" /> Contact number
                  </span>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel"
                    inputMode="tel"
                    placeholder="+63 9XX XXX XXXX"
                    className="portfolio-lead-field w-full px-3.5 py-2.5 text-sm transition"
                    style={fieldStyle}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold" style={{ color: resolved.muted }}>
                    <Mail className="h-3.5 w-3.5" /> Email
                  </span>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    type="email"
                    placeholder="you@email.com"
                    className="portfolio-lead-field w-full px-3.5 py-2.5 text-sm transition"
                    style={fieldStyle}
                  />
                </label>

                {error ? (
                  <p className="px-3 py-2 text-sm" style={errorStyle}>
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex w-full items-center justify-center gap-2 px-4 py-3 text-sm font-semibold transition hover:opacity-95 disabled:opacity-60"
                  style={primaryBtn}
                >
                  <Handshake className="h-4 w-4" />
                  {busy ? 'Sending…' : 'Share my details'}
                </button>

                <p className="text-center text-[11px] leading-5" style={{ color: resolved.muted }}>
                  By sharing, you agree to the{' '}
                  <button
                    type="button"
                    className="font-semibold underline-offset-2 hover:underline"
                    style={{ color: resolved.accent }}
                    onClick={() => setPolicy('terms')}
                  >
                    Terms
                  </button>{' '}
                  and{' '}
                  <button
                    type="button"
                    className="font-semibold underline-offset-2 hover:underline"
                    style={{ color: resolved.accent }}
                    onClick={() => setPolicy('privacy')}
                  >
                    Privacy Policy
                  </button>
                  .
                </p>
              </form>
            )}
          </div>
        </div>
      </div>

      <LegalPolicyModal
        open={Boolean(policy)}
        policy={policy}
        onClose={() => setPolicy(null)}
        onPolicyChange={setPolicy}
      />
    </>,
    document.body,
  );
}

/** Whether the guest lead prompt may open for this alias. */
export function canPromptVisitorLead(alias: string): boolean {
  if (!alias) return false;
  return !hasSubmittedVisitorLead(alias);
}
