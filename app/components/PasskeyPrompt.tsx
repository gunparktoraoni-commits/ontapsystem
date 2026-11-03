'use client';

import { startRegistration } from '@simplewebauthn/browser';
import { Fingerprint, ShieldCheck, X } from 'lucide-react';
import React, { useState } from 'react';
import { InlineLoader } from './Loader';
import { ModalPortal } from './ModalPortal';
import { getFrontendApiBaseUrl } from './apiBase';

const API = getFrontendApiBaseUrl();

// ── CSRF helpers ──────────────────────────────────────────────────────────
// The webauthn/register endpoints require CSRF validation.
// We fetch a fresh token from /api/csrf-token before each state-changing request.
// Using the response body (not the cookie) avoids Safari ITP blocking.

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
    const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
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

async function buildHeaders(extraHeaders?: Record<string, string>): Promise<Headers> {
  const token = await fetchCsrfToken();
  const headers = new Headers({ 'Content-Type': 'application/json', ...extraHeaders });
  if (token) {
    headers.set('X-CSRF-Token', token);
    headers.set('x-csrf-token', token);
  }
  return headers;
}
// ─────────────────────────────────────────────────────────────────────────

interface PasskeyPromptProps {
  /**
   * Called after a passkey is successfully created (or after the brief success
   * animation completes).
   */
  onComplete: () => void;
  /**
   * Called when the user chooses to skip passkey creation.
   */
  onSkip: () => void;
  /**
   * When true, the component renders as an inline card suitable for
   * multi-step flows (e.g., the registration wizard). The step indicator
   * and navigation chrome are then the parent's responsibility.
   *
   * When false (default), the component renders as a fixed modal overlay
   * (useful for the post-login prompt).
   */
  inline?: boolean;
}

/**
 * PasskeyPrompt Component
 *
 * Presents users with the option to register a passkey (Face ID, Touch ID,
 * fingerprint, or Windows Hello) for faster and more secure future logins.
 *
 * Used in two contexts:
 * 1. **Inline (registration wizard):** Rendered as a card step between theme
 *    selection and the "Setup Complete" screen.
 * 2. **Overlay (post-login prompt):** Shown as a fixed modal after the user's
 *    first password-only login, offering them the chance to enroll without
 *    leaving the current page.
 *
 * In both cases "Skip" is always visible so users are never forced into
 * biometric enrollment.
 *
 * Security:
 * - CSRF token sent with every WebAuthn request
 * - Biometric data never leaves the device — only a signed credential is sent
 * - Registration challenge is validated server-side via reauth_state cookie
 */
export default function PasskeyPrompt({ onComplete, onSkip, inline = false }: PasskeyPromptProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleRegisterPasskey = async () => {
    setError('');
    setLoading(true);

    try {
      // Check if WebAuthn is supported on the current device/browser
      if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials) {
        setError('Your browser does not support passkey authentication. You can skip this step and add a passkey later from Settings.');
        return;
      }

      // Optionally surface capability info for better UX on unsupported devices
      const isUserVerifyingAvailable =
        typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
          ? await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false)
          : false;

      if (!isUserVerifyingAvailable) {
        setError('Your device does not have a compatible biometric authenticator. You can skip this step and add a passkey later when using a supported device.');
        return;
      }

      // Fetch registration options from server with CSRF token
      const optionsHeaders = await buildHeaders();
      const optionsResponse = await fetch(`${API}/api/auth/webauthn/register/options`, {
        method: 'POST',
        credentials: 'include',
        headers: optionsHeaders,
      });

      if (!optionsResponse.ok) {
        const optionsData = await optionsResponse.json().catch(() => ({})) as Record<string, unknown>;
        setError(String(optionsData.error ?? 'Unable to start passkey registration.'));
        return;
      }

      const optionsData = await optionsResponse.json();

      // Initiate WebAuthn registration ceremony — browser shows native biometric prompt
      const credential = await startRegistration(optionsData.options);

      // Send credential to server for verification and storage
      const verifyHeaders = await buildHeaders();
      const verifyResponse = await fetch(`${API}/api/auth/webauthn/register/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: verifyHeaders,
        body: JSON.stringify({ credential }),
      });

      if (!verifyResponse.ok) {
        const verifyData = await verifyResponse.json().catch(() => ({})) as Record<string, unknown>;
        setError(String(verifyData.error ?? 'Passkey registration failed.'));
        return;
      }

      setSuccess(true);

      // Auto-proceed after briefly showing the success confirmation
      setTimeout(() => {
        onComplete();
      }, 1500);
    } catch (err) {
      console.error('Passkey registration error:', err);

      if (err instanceof Error) {
        if (err.name === 'NotAllowedError') {
          setError('Registration was cancelled. You can add a passkey later from your account Settings.');
        } else if (err.name === 'InvalidStateError') {
          // Credential already registered on this device — treat as success
          setError('This device already has a passkey registered.');
          setTimeout(() => {
            onComplete();
          }, 2000);
        } else {
          setError('Unable to register passkey. Please try again later.');
        }
      } else {
        setError('An unexpected error occurred during passkey registration.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Success state ──────────────────────────────────────────────────────

  if (success) {
    if (inline) {
      return (
        <div className="w-full max-w-md bg-white rounded-2xl p-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <ShieldCheck className="h-8 w-8 text-green-600" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Passkey created!</h2>
          <p className="text-gray-500 text-sm">
            You can now use biometric authentication for faster, more secure logins.
          </p>
          <p className="text-xs text-gray-400 mt-3">Continuing to your setup…</p>
        </div>
      );
    }

    return (
      <ModalPortal isOpen={success} onClose={onSkip}>
        <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl animate-scale-in">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <ShieldCheck className="h-8 w-8 text-green-600" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-center text-gray-900 mb-2">Passkey created!</h2>
          <p className="text-gray-600 text-center text-sm">
            You can now use biometric authentication for faster, more secure logins.
          </p>
        </div>
      </ModalPortal>
    );
  }

  // ── Form content (shared between inline and overlay) ───────────────────

  const formContent = (
    <>
      <div className="flex justify-between items-start mb-6">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
              <Fingerprint className="h-6 w-6 text-[#2D3A8C]" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">
              {inline ? 'Secure your account' : 'Secure your account'}
            </h2>
          </div>
          <p className="text-gray-600 text-sm leading-relaxed">
            Enhance your account security with a passkey. Use{' '}
            <span className="font-medium">Face ID, Fingerprint, or a security key</span> for faster,
            password-free login on this device.
          </p>
        </div>
        {/* Skip "X" button — always visible so users are never forced */}
        <button
          type="button"
          onClick={onSkip}
          disabled={loading}
          className="text-gray-400 hover:text-gray-600 transition-colors ml-2 shrink-0"
          aria-label="Skip passkey setup"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-3">
        <button
          type="button"
          onClick={() => void handleRegisterPasskey()}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-[#2D3A8C] hover:bg-[#243080] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-all duration-300 text-base"
        >
          {loading ? (
            <>
              <InlineLoader />
              Setting up passkey…
            </>
          ) : (
            <>
              <ShieldCheck className="h-5 w-5" />
              Create passkey
            </>
          )}
        </button>

        {/* Always-visible skip button */}
        <button
          type="button"
          onClick={onSkip}
          disabled={loading}
          className="w-full text-gray-600 hover:text-gray-800 font-medium py-2 transition-colors text-sm disabled:opacity-50"
        >
          Skip — I&apos;ll do this later
        </button>
      </div>

      <div className="mt-6 pt-6 border-t border-gray-100">
        <p className="text-xs text-gray-500 text-center leading-relaxed">
          Your biometric data never leaves your device. We only store a secure cryptographic key.
          You can manage your passkeys any time from Settings.
        </p>
      </div>
    </>
  );

  // ── Inline rendering (registration wizard step) ────────────────────────

  if (inline) {
    return (
      <div className="w-full max-w-md bg-white rounded-2xl p-8">
        {formContent}
      </div>
    );
  }

  // ── Overlay rendering (post-login prompt) ─────────────────────────────

  return (
    <ModalPortal isOpen={!inline && !success} onClose={onSkip}>
      <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl animate-scale-in">
        {formContent}
      </div>
    </ModalPortal>
  );
}
