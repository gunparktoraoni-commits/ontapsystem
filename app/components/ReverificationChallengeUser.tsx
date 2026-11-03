'use client';

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { ArrowLeft, Fingerprint, KeyRound, Mail, ShieldCheck } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { InlineLoader } from './Loader';
import { getFrontendApiBaseUrl } from './apiBase';

const API = getFrontendApiBaseUrl();

function writeAuthUser(userLike: unknown) {
  if (typeof window === 'undefined') return;
  try {
    const u = userLike && typeof userLike === 'object' ? (userLike as Record<string, unknown>) : {};
    const first = String(u.firstName ?? u.first_name ?? '').trim();
    const last = String(u.lastName ?? u.last_name ?? '').trim();
    const fullFallback = String(u.fullName ?? u.full_name ?? u.name ?? '').trim();
    const full = [first, last].filter(Boolean).join(' ').trim() || fullFallback;
    localStorage.setItem('authUser', JSON.stringify({
      ...u,
      firstName: first,
      lastName: last,
      fullName: full,
    }));
  } catch {
    // ignore localStorage errors
  }
  window.dispatchEvent(new CustomEvent('ontap:user-sync'));
}

// ── CSRF helpers ──────────────────────────────────────────────────────────
// The reauth endpoints go through the CSRF guard in proxy.ts.
// Safari/iOS ITP may block the csrf-token cookie, so we always fetch a fresh
// token from /api/csrf-token before every state-changing reauth request.
// Using the response body (not the cookie) avoids ITP partitioning entirely.

const CSRF_COOKIE_NAME = 'csrf-token';

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const pairs = document.cookie.split('; ');
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) continue;
      const key = decodeURIComponent(pair.slice(0, eqIdx).trim());
      if (key !== CSRF_COOKIE_NAME) continue;
      const val = decodeURIComponent(pair.slice(eqIdx + 1).trim());
      return val || null;
    }
  } catch {
    // ignore errors
  }
  return null;
}

async function fetchCsrfToken(): Promise<string | null> {
  try {
    const res = await fetch(`${API}/api/csrf-token`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) return readCsrfCookie();
    const payload = await res.json().catch(() => null) as Record<string, unknown> | null;
    const bodyToken =
      (payload?.csrfToken && typeof payload.csrfToken === 'string' ? payload.csrfToken : null) ||
      (payload?.token && typeof payload.token === 'string' ? payload.token : null) ||
      null;
    // Prefer body token (immune to ITP) then fall back to cookie
    return bodyToken?.trim() || readCsrfCookie();
  } catch {
    return readCsrfCookie();
  }
}

async function buildReauthHeaders(extraHeaders?: Record<string, string>): Promise<Headers> {
  const token = await fetchCsrfToken();
  const headers = new Headers({ 'Content-Type': 'application/json', ...extraHeaders });
  if (token) {
    headers.set('X-CSRF-Token', token);
    headers.set('x-csrf-token', token);
  }
  return headers;
}
// ─────────────────────────────────────────────────────────────────────────

interface Props {
  email: string;
  userId?: number;
  hasWebAuthnCredential?: boolean;
  otpSent?: boolean;
  onCompleted: () => void;
  onBack?: () => void;
}

function parseResponseJson<T>(value: Response): Promise<T> {
  return value.json() as Promise<T>;
}

export default function ReverificationChallengeUser({
  email,
  userId,
  hasWebAuthnCredential = false,
  otpSent = true,
  onCompleted,
  onBack,
}: Props) {
  const [canUseWebAuthn, setCanUseWebAuthn] = useState(false);
  const [loadingMode, setLoadingMode] = useState<'passkey' | 'otp' | 'register' | null>(null);
  const [phase, setPhase] = useState<'challenge' | 'success'>('challenge');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(otpSent ? '' : 'A verification code was sent, but delivery may need to be retried.');
  const [code, setCode] = useState<string[]>(['', '', '', '', '', '']);
  const [verifiedUser, setVerifiedUser] = useState<Record<string, unknown> | null>(null);
  const [passkeyEnrolled, setPasskeyEnrolled] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const supported = typeof window !== 'undefined' && Boolean(window.PublicKeyCredential && navigator.credentials);
    setCanUseWebAuthn(supported);
  }, []);

  const maskedEmail = useMemo(() => {
    if (!email) return '';
    return email.replace(/^(.{2})(.*)(@.*)$/, (_, a, b, c) => a + '*'.repeat(Math.max(1, b.length)) + c);
  }, [email]);

  const resetOtp = () => {
    setCode(['', '', '', '', '', '']);
    inputRefs.current[0]?.focus();
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^[a-zA-Z0-9]*$/.test(value)) return;
    const next = [...code];
    next[index] = value.slice(-1);
    setCode(next);
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, event: React.KeyboardEvent) => {
    if (event.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (event: React.ClipboardEvent) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6);
    const next = [...code];
    for (let index = 0; index < pasted.length; index += 1) {
      next[index] = pasted[index];
    }
    setCode(next);
    inputRefs.current[Math.min(pasted.length, 5)]?.focus();
  };

  const finalizeSuccess = (user: Record<string, unknown>) => {
    setVerifiedUser(user);
    writeAuthUser(user);
    setPhase('success');
  };

  const handlePasskeyLogin = async () => {
    setError('');
    setNotice('');
    if (!canUseWebAuthn) {
      setError('This browser does not support passkey authentication. Use the verification code instead.');
      return;
    }
    if (!hasWebAuthnCredential) {
      setError('No passkey is enrolled for this account yet. Use the verification code first.');
      return;
    }

    setLoadingMode('passkey');
    try {
      // Fetch a fresh CSRF token before each state-changing reauth request.
      // We use the response body token (not cookie) to avoid Safari ITP blocking.
      const optionsHeaders = await buildReauthHeaders();
      const optionsResponse = await fetch(`${API}/api/auth/webauthn/auth/options`, {
        method: 'POST',
        credentials: 'include',
        headers: optionsHeaders,
        body: JSON.stringify({ userId, email }),
      });

      const optionsData = await parseResponseJson<Record<string, any>>(optionsResponse);
      if (!optionsResponse.ok) {
        if (optionsResponse.status === 409) {
          setError('No passkey is enrolled for this account yet. Use the verification code instead.');
          return;
        }
        setError(optionsData.error ?? optionsData.message ?? 'Unable to start passkey verification.');
        return;
      }

      const credential = await startAuthentication(optionsData.options);
      // Fetch a fresh CSRF token for the verify request too (token may have been consumed)
      const verifyHeaders = await buildReauthHeaders();
      const verifyResponse = await fetch(`${API}/api/auth/webauthn/auth/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: verifyHeaders,
        body: JSON.stringify({ credential }),
      });
      const verifyData = await parseResponseJson<Record<string, any>>(verifyResponse);
      if (!verifyResponse.ok) {
        setError(verifyData.error ?? verifyData.message ?? 'Passkey verification failed.');
        return;
      }

      finalizeSuccess(verifyData.user ?? optionsData.user ?? {});
    } catch {
      setError('Passkey authentication failed. Please use the verification code.');
    } finally {
      setLoadingMode(null);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const otp = code.join('');
    if (otp.length < 6) {
      setError('Please enter the complete 6-digit code.');
      return;
    }

    setError('');
    setLoadingMode('otp');
    try {
      // Always fetch a fresh CSRF token — critical in production (Hostinger) where
      // the reverification flow is pre-session and the CSRF cookie may be absent.
      const headers = await buildReauthHeaders();
      const response = await fetch(`${API}/api/auth/reauth/otp/verify`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ code: otp }),
      });
      const data = await parseResponseJson<Record<string, any>>(response);
      if (!response.ok) {
        // If we still got a CSRF error, retry once with a completely fresh token.
        if (response.status === 403 && (data.code === 'CSRF_TOKEN_INVALID' || data.error?.toLowerCase().includes('csrf'))) {
          const retryHeaders = await buildReauthHeaders();
          const retry = await fetch(`${API}/api/auth/reauth/otp/verify`, {
            method: 'POST',
            credentials: 'include',
            headers: retryHeaders,
            body: JSON.stringify({ code: otp }),
          });
          const retryData = await parseResponseJson<Record<string, any>>(retry);
          if (!retry.ok) {
            setError(retryData.error ?? retryData.message ?? 'Invalid verification code.');
            return;
          }
          finalizeSuccess(retryData.user ?? {});
          resetOtp();
          return;
        }
        setError(data.error ?? data.message ?? 'Invalid verification code.');
        return;
      }

      finalizeSuccess(data.user ?? {});
      resetOtp();
    } catch {
      setError('Unable to connect. Please check your internet connection.');
    } finally {
      setLoadingMode(null);
    }
  };

  const handleResendOtp = async () => {
    setNotice('');
    setError('');
    setLoadingMode('otp');
    try {
      const headers = await buildReauthHeaders();
      const response = await fetch(`${API}/api/auth/reauth/otp/send`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ userId, email }),
      });
      const data = await parseResponseJson<Record<string, any>>(response);
      if (!response.ok) {
        setError(data.error ?? data.message ?? 'Could not resend the verification code.');
        return;
      }
      setCode(['', '', '', '', '', '']);
      setNotice('A new verification code has been sent to your email.');
    } catch {
      setError('Unable to connect. Please check your internet connection.');
    } finally {
      setLoadingMode(null);
    }
  };

  const handleRegisterPasskey = async () => {
    setError('');
    setNotice('');

    if (!canUseWebAuthn) {
      setError('This browser does not support passkeys.');
      return;
    }

    setLoadingMode('register');
    try {
      const optionsHeaders = await buildReauthHeaders();
      const optionsResponse = await fetch(`${API}/api/auth/webauthn/register/options`, {
        method: 'POST',
        credentials: 'include',
        headers: optionsHeaders,
      });
      const optionsData = await parseResponseJson<Record<string, any>>(optionsResponse);
      if (!optionsResponse.ok) {
        setError(optionsData.error ?? optionsData.message ?? 'Unable to start passkey enrollment.');
        return;
      }

      const credential = await startRegistration(optionsData.options);
      const verifyHeaders = await buildReauthHeaders();
      const verifyResponse = await fetch(`${API}/api/auth/webauthn/register/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: verifyHeaders,
        body: JSON.stringify({ credential }),
      });
      const verifyData = await parseResponseJson<Record<string, any>>(verifyResponse);
      if (!verifyResponse.ok) {
        setError(verifyData.error ?? verifyData.message ?? 'Passkey enrollment failed.');
        return;
      }

      setPasskeyEnrolled(true);
      setNotice('Passkey enrolled successfully.');
    } catch {
      setError('Passkey enrollment failed. Please try again later.');
    } finally {
      setLoadingMode(null);
    }
  };

  if (phase === 'success') {
    return (
      <div className="w-full max-w-md rounded-2xl p-4 sm:p-8 text-center">
        <div className="flex justify-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center">
            <ShieldCheck className="h-7 w-7 text-green-600" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Verification complete</h1>
        <p className="text-gray-500 text-sm mb-6">
          Access has been restored for {maskedEmail || 'your account'}.
        </p>
        {notice && (
          <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {notice}
          </div>
        )}
        <div className="space-y-3">
          <button
            type="button"
            onClick={onCompleted}
            className="w-full rounded-full bg-[#2D3A8C] px-4 py-3 font-semibold text-white hover:bg-[#243080] transition-colors"
          >
            Continue to dashboard
          </button>
          {canUseWebAuthn && !passkeyEnrolled && (
            <button
              type="button"
              onClick={handleRegisterPasskey}
              disabled={loadingMode === 'register'}
              className="w-full rounded-full border border-[#2D3A8C] px-4 py-3 font-semibold text-[#2D3A8C] hover:bg-blue-50 transition-colors disabled:opacity-60"
            >
              {loadingMode === 'register' ? 'Adding passkey...' : 'Set up this device as a passkey'}
            </button>
          )}
        </div>
        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-2xl p-4 sm:p-8 text-center">
      <div className="flex justify-center mb-6">
        <img src="/ontaplogo.svg" alt="OnTap Logo" width={70} height={70} className="w-17.5 h-auto" draggable={false} decoding="async" />
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-2">Verification required</h1>
      <p className="text-gray-400 text-sm mb-8 break-words px-1">
        We need one more check before restoring access to {maskedEmail || 'your account'}.
      </p>

      {!otpSent && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-800 break-words">
          We could not deliver the verification email automatically. You can request a new code below.
        </div>
      )}

      {notice && (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-left text-sm text-green-700 break-words">
          {notice}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-700 break-words">
          {error}
        </div>
      )}

      <div className="space-y-3 rounded-2xl border border-gray-200 p-4 sm:p-5 mb-6 text-left">
        <button
          type="button"
          onClick={handlePasskeyLogin}
          disabled={loadingMode !== null || !canUseWebAuthn || !hasWebAuthnCredential}
          className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-[#2D3A8C] px-4 py-3 font-semibold text-white hover:bg-[#243080] transition-colors disabled:opacity-60"
        >
          {loadingMode === 'passkey' ? <InlineLoader /> : <Fingerprint className="h-4 w-4" />}
          {hasWebAuthnCredential ? 'Use Face ID / Fingerprint' : 'No passkey enrolled'}
        </button>
        <p className="text-xs text-gray-400 text-center">
          {canUseWebAuthn && hasWebAuthnCredential
            ? 'Your device can use a biometric passkey if one is enrolled.'
            : 'Use the email verification code as fallback.'}
        </p>
      </div>

      <div className="border border-gray-200 rounded-2xl p-4 sm:p-6 mb-6">
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center">
            <Mail className="h-7 w-7 text-[#2D3A8C]" />
          </div>
        </div>

        <p className="text-sm text-gray-500 mb-6 break-words">
          Enter the 6-digit verification code sent to{' '}
          <span className="font-semibold text-gray-700">{maskedEmail || 'your email'}</span>
        </p>

        <form onSubmit={handleOtpSubmit}>
          <div className="flex justify-center gap-1.5 sm:gap-2 mb-6">
            {code.map((digit, index) => (
              <input
                key={index}
                ref={(element) => {
                  inputRefs.current[index] = element;
                }}
                type="text"
                inputMode="text"
                maxLength={1}
                value={digit}
                onChange={(event) => handleOtpChange(index, event.target.value)}
                onKeyDown={(event) => handleOtpKeyDown(index, event)}
                onPaste={handleOtpPaste}
                disabled={loadingMode === 'otp'}
                className="w-9 h-10 sm:w-11 sm:h-11 text-center text-base sm:text-lg font-semibold border border-gray-200 rounded-xl focus:outline-none focus:border-[#2D3A8C] focus:ring-2 focus:ring-blue-100 transition-all disabled:opacity-50 min-w-0"
              />
            ))}
          </div>

          <button
            type="submit"
            disabled={loadingMode === 'otp'}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-[#2D3A8C] px-4 py-3 font-semibold text-white hover:bg-[#243080] transition-colors disabled:opacity-60"
          >
            {loadingMode === 'otp' ? <InlineLoader /> : <KeyRound className="h-4 w-4" />}
            Verify code
          </button>
        </form>

        <p className="mt-4 text-sm text-gray-400">
          Didn&apos;t receive the code?{' '}
          <button
            type="button"
            onClick={handleResendOtp}
            disabled={loadingMode === 'otp'}
            className="font-semibold text-blue-600 hover:underline disabled:opacity-50"
          >
            Resend
          </button>
        </p>
      </div>

      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-gray-400 text-sm hover:text-gray-600 transition-colors cursor-pointer"
      >
        <ArrowLeft className="h-4 w-4" />
        back to login
      </button>
    </div>
  );
}
