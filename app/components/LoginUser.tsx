'use client';

import { startAuthentication } from '@simplewebauthn/browser';
import { Eye, EyeOff, Lock, Mail, Fingerprint } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useState, useRef } from 'react';
import VerifyEmailUser from './VerifyEmailUser';
import ReverificationChallengeUser from './ReverificationChallengeUser';
import BiometricLoginModal from './BiometricLoginModal';
import PasskeyPrompt from './PasskeyPrompt';
import { ForceChangeEmailModal } from './ForceChangeEmailModal';
import { getFrontendApiBaseUrl } from './apiBase';
import { InlineLoader } from './Loader';
import { showToast } from './Toast';
import {
  buildSignupHrefWithRedirect,
  persistClaimSerial,
  readClaimSerialFromSearchParams,
  resolvePostLoginClaimPath,
} from '@/lib/bizcard/claim-urls';

// ── Mobile device detection ──────────────────────────────────────────────────
// Returns true only for touch-primary handheld devices (phones/tablets with
// biometric sensors). We combine three independent signals so that neither
// a large-screen tablet in mouse mode nor a desktop with a touchscreen is
// incorrectly classified as "mobile".
//
// 1. pointer:coarse  — primary pointing device is touch (finger), not a mouse
// 2. narrow viewport — screen narrower than 768 CSS px (phones / small tablets)
// 3. UA token match  — user-agent contains well-known mobile OS/browser tokens
//
// All three must agree before we consider the device mobile.  This is
// intentionally conservative: false-negatives (mobile user sees no auto-prompt)
// are acceptable; false-positives (desktop user unexpectedly prompted) are not.
function isMobileDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  // Signal 1: coarse pointer (touch as primary input)
  const hasCoarsePointer =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;

  // Signal 2: narrow viewport width
  const hasNarrowViewport = window.innerWidth < 768;

  // Signal 3: mobile OS / browser tokens in user-agent
  const ua = navigator.userAgent ?? '';
  const mobileUaPattern =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS|FxiOS/i;
  const hasMobileUa = mobileUaPattern.test(ua);

  // Require at least two of the three signals to reduce false-positives on
  // devices like large-screen Android tablets used with a Bluetooth mouse.
  const signalCount = [hasCoarsePointer, hasNarrowViewport, hasMobileUa].filter(Boolean).length;
  return signalCount >= 2;
}

// ── Server-side passkey existence check ─────────────────────────────────────
// Queries the database via GET /api/auth/webauthn/passkey-exists to confirm
// that the email stored in localStorage actually has an enrolled passkey.
//
// WHY server-side instead of relying only on localStorage?
// - localStorage can be cleared by privacy-focused browsers (Brave, Safari ITP,
//   Firefox with Enhanced Tracking Protection) or manually by the user.
// - Conversely, a stale localStorage entry may reference a passkey that was
//   deleted from the server (e.g. via Settings → Remove passkey).
// - The server is the single source of truth; localStorage is only a hint to
//   avoid an unnecessary network round-trip when no email is stored.
//
// Returns false on network error or invalid response so callers can degrade
// gracefully rather than crashing.

const API_BASE_URL = getFrontendApiBaseUrl();

async function checkPasskeyExistsOnServer(email: string): Promise<boolean> {
  try {
    const encodedEmail = encodeURIComponent(email.trim().toLowerCase());
    const res = await fetch(
      `${API_BASE_URL}/api/auth/webauthn/passkey-exists?email=${encodedEmail}`,
      {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store', // Always fresh — credential list may have changed
        headers: { 'Accept': 'application/json' },
      }
    );

    if (!res.ok) {
      // Non-2xx response (e.g. 429 rate limit, 400 bad input) — degrade gracefully
      console.warn('[PasskeyCheck] Server returned', res.status, '— defaulting to false');
      return false;
    }

    const data = await res.json().catch(() => null);
    if (!data || typeof data !== 'object') return false;

    return data.hasPasskey === true;
  } catch {
    // Network error or JSON parse failure — degrade gracefully
    return false;
  }
}
const SAVED_EMAIL_KEY = 'savedLoginEmail';
const LAST_PASSKEY_USER_KEY = 'lastPasskeyUser';
const LEGACY_SAVED_CREDENTIALS_KEY = 'savedCredentials';

function loadSavedEmail(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const savedEmail = localStorage.getItem(SAVED_EMAIL_KEY);
    if (savedEmail && savedEmail.trim()) {
      return savedEmail.trim();
    }

    const legacyRaw = localStorage.getItem(LEGACY_SAVED_CREDENTIALS_KEY);
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw) as { email?: string } | null;
      localStorage.removeItem(LEGACY_SAVED_CREDENTIALS_KEY);
      if (parsed && typeof parsed.email === 'string' && parsed.email.trim()) {
        return parsed.email.trim();
      }
    }
    return null;
  } catch {
    return null;
  }
}

function persistSavedEmail(email: string) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SAVED_EMAIL_KEY, email);
    localStorage.removeItem(LEGACY_SAVED_CREDENTIALS_KEY);
  } catch {
    // ignore localStorage errors
  }
}

function persistLastPasskeyUser(email: string) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LAST_PASSKEY_USER_KEY, email.trim().toLowerCase());
  } catch {
    // ignore localStorage errors
  }
}

function loadLastPasskeyUser(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const email = localStorage.getItem(LAST_PASSKEY_USER_KEY);
    return email && email.trim() ? email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

function clearLastPasskeyUser() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(LAST_PASSKEY_USER_KEY);
  } catch {
    // ignore localStorage errors
  }
}

function clearSavedEmail() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(SAVED_EMAIL_KEY);
    localStorage.removeItem(LEGACY_SAVED_CREDENTIALS_KEY);
  } catch {
    // ignore localStorage errors
  }
}
function writeAuthUser(userLike: unknown) {
  if (typeof window === 'undefined') return;
  try {
    const u = userLike && typeof userLike === 'object'
      ? (userLike as Record<string, unknown>)
      : {};
    const first = String(u.firstName ?? u.first_name ?? '').trim();
    const last = String(u.lastName ?? u.last_name ?? '').trim();
    const fullFallback = String(u.fullName ?? u.full_name ?? u.name ?? '').trim();
    const full = [first, last].filter(Boolean).join(' ').trim() || fullFallback;
    const rawId = u.id ?? u.userId ?? u.user_id;
    const id =
      rawId === null || rawId === undefined || rawId === ''
        ? undefined
        : String(rawId);

    localStorage.setItem('authUser', JSON.stringify({
      ...u,
      ...(id ? { id, userId: id, user_id: id } : {}),
      firstName: first,
      lastName: last,
      fullName: full,
    }));
  } catch {
    // ignore localStorage errors
  }
  window.dispatchEvent(new CustomEvent('ontap:user-sync'));
}

const LoginUser = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get('redirect');
  const claimSerial = readClaimSerialFromSearchParams(searchParams);

  useEffect(() => {
    if (claimSerial) persistClaimSerial(claimSerial);
  }, [claimSerial]);

  const resolveLoginTarget = (defaultDashboard: string) =>
    resolvePostLoginClaimPath({
      redirectPath,
      serialFromUrl: claimSerial,
      defaultDashboard,
    });

  const navigateAfterLogin = (userLike: Record<string, unknown> | null | undefined) => {
    const role = String(userLike?.role ?? userLike?.user_role ?? '').toLowerCase();
    const isCompanyAdmin = role === 'company_admin' || role === 'admin' || role === 'manager';
    const defaultDashboard = isCompanyAdmin ? '/admin/dashboard' : '/user/dashboard';
    const targetPath = resolveLoginTarget(defaultDashboard);

    if (userLike?.requiresPasswordChange === true) {
      sessionStorage.setItem('post_password_change_redirect', targetPath);
      sessionStorage.setItem('post_login_redirect', targetPath);
      router.push('/user/change-password-required');
      return;
    }

    // PCO placeholder accounts must change email on the login page before entering the app.
    if (userLike?.requiresEmailChange === true) {
      sessionStorage.setItem('post_login_redirect', targetPath);
      setForceEmailCurrent(String(userLike.email ?? formData.email.trim()));
      setForceEmailChangeOpen(true);
      return;
    }

    router.push(targetPath);
  };

  const signupHref = buildSignupHrefWithRedirect(redirectPath, claimSerial);

  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const [reverification, setReverification] = useState(false);
  const [showBiometricModal, setShowBiometricModal] = useState(false);
  const [showPasskeyPrompt, setShowPasskeyPrompt] = useState(false);
  const [autoPromptAttempted, setAutoPromptAttempted] = useState(false);
  const [autoPromptLoading, setAutoPromptLoading] = useState(false);
  const [hasBiometricCapability, setHasBiometricCapability] = useState(false);
  const [checkingBiometricAvailability, setCheckingBiometricAvailability] = useState(true);
  const [forceEmailChangeOpen, setForceEmailChangeOpen] = useState(false);
  const [forceEmailCurrent, setForceEmailCurrent] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const [biometricData, setBiometricData] = useState<{
    email: string;
    hasCredential: boolean;
  } | null>(null);
  const [reverificationData, setReverificationData] = useState<{
    userId?: number;
    email: string;
    hasWebAuthnCredential: boolean;
    otpSent: boolean;
  } | null>(null);
  const [verifyUserId, setVerifyUserId] = useState<number | undefined>(undefined);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  useEffect(() => {
    const savedEmail = loadSavedEmail();
    if (savedEmail) {
      setFormData((previous) => ({ ...previous, email: savedEmail }));
      setRememberMe(true);
    }

    // Check if biometric authentication is available for the manual button.
    // The manual "Login with Biometrics" button is shown on any device
    // (mobile or desktop) that:
    //   (a) has WebAuthn / PublicKeyCredential support, AND
    //   (b) has a stored lastPasskeyUser email in localStorage, AND
    //   (c) the server confirms a passkey actually exists in the database
    //       for that email (source of truth — avoids stale localStorage,
    //       handles Brave/Safari ITP clearing storage, and accounts for
    //       passkeys that were deleted via Settings on another device).
    //
    // We do NOT require conditional mediation here — the manual button uses
    // an explicit user gesture which works everywhere.
    // Conditional mediation is only needed for the mobile auto-prompt.
    const checkBiometricCapability = async () => {
      try {
        if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials) {
          setHasBiometricCapability(false);
          setCheckingBiometricAvailability(false);
          return;
        }

        // Step 1: Fast local hint — if no email is stored, skip the network
        // call entirely.  This avoids a redundant fetch on every page load for
        // users who have never used a passkey on this device.
        const lastPasskeyEmail = loadLastPasskeyUser();
        if (!lastPasskeyEmail) {
          setHasBiometricCapability(false);
          setCheckingBiometricAvailability(false);
          return;
        }

        // Step 2: Server-side DB check — verify the passkey actually exists.
        // This is the authoritative source of truth.  If the server returns
        // false (passkey deleted, account deactivated, network error), we hide
        // the button and clear the stale localStorage entry.
        const serverHasPasskey = await checkPasskeyExistsOnServer(lastPasskeyEmail);
        if (!serverHasPasskey) {
          // Stale or invalidated entry — clear it so subsequent visits don't
          // incur unnecessary server calls.
          clearLastPasskeyUser();
          setHasBiometricCapability(false);
          setCheckingBiometricAvailability(false);
          return;
        }

        setHasBiometricCapability(true);
      } catch {
        setHasBiometricCapability(false);
      } finally {
        setCheckingBiometricAvailability(false);
      }
    };

    void checkBiometricCapability();
  }, []);

  // If a PCO session already exists (e.g. redirected from dashboard), reopen the change-email modal.
  useEffect(() => {
    let cancelled = false;
    const checkPendingEmailChange = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/session`, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!res.ok || cancelled) return;
        const data = await res.json().catch(() => null);
        if (cancelled || !data?.authenticated || data.user?.requiresEmailChange !== true) return;
        setForceEmailCurrent(String(data.user?.email ?? ''));
        setForceEmailChangeOpen(true);
        if (data.user) writeAuthUser(data.user);
      } catch {
        // ignore — login page remains usable without a session
      }
    };
    void checkPendingEmailChange();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Auto-prompt for passkey authentication on page load (mobile only).
   *
   * This implements the GCash-like experience where biometric authentication
   * automatically appears when the user opens the login page if they have
   * a registered passkey AND are on a mobile device (iPhone Face ID, Android
   * fingerprint, etc.).
   *
   * Requirements for the auto-prompt to fire:
   *   1. Device is mobile (touch-primary, narrow viewport, mobile UA)
   *   2. A `lastPasskeyUser` email is stored in localStorage
   *   3. The browser supports WebAuthn conditional mediation
   *   4. The server confirms the email has enrolled credentials
   *
   * Desktop users — including those who have a passkey — must click the
   * manual "Login with Biometrics" button instead.  This prevents unexpected
   * browser dialogs on non-mobile platforms.
   *
   * Uses WebAuthn Conditional Mediation (useBrowserAutofill: true) so the
   * platform authenticator UI appears inline/via the browser autofill without
   * requiring an explicit user gesture.
   */
  useEffect(() => {
    if (autoPromptAttempted) return;

    const attemptAutoPasskeyAuth = async () => {
      try {
        // ── Guard 1: mobile-only ───────────────────────────────────────────
        // Auto-prompt MUST NOT fire on desktop or unsupported environments.
        // The manual biometric button serves desktop users.
        if (!isMobileDevice()) {
          console.log('[AutoPasskey] Non-mobile device — skipping auto-prompt');
          return;
        }

        // ── Guard 2: not already in another auth sub-flow ─────────────────
        if (unverified || reverification || showBiometricModal || showPasskeyPrompt || loading) {
          return;
        }

        // ── Guard 3: WebAuthn API must be present ─────────────────────────
        if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials) {
          console.log('[AutoPasskey] WebAuthn not supported');
          return;
        }

        // ── Guard 4: browser must support conditional mediation ────────────
        // Without conditional mediation the browser cannot show the passkey
        // picker inline — we would need an explicit user gesture, which defeats
        // the auto-prompt purpose.  Fall back to manual button in that case.
        const conditionalMediationAvailable =
          typeof PublicKeyCredential.isConditionalMediationAvailable === 'function'
            ? await PublicKeyCredential.isConditionalMediationAvailable().catch(() => false)
            : false;

        if (!conditionalMediationAvailable) {
          console.log('[AutoPasskey] Conditional mediation not supported — manual button available');
          return;
        }

        // ── Guard 5: server-side passkey existence check ─────────────────
        // localStorage is the local hint (fast, no network call) but is NOT
        // the source of truth.  Privacy browsers (Brave, Safari ITP, Edge
        // Enhanced Tracking Protection) may clear localStorage between visits.
        // Conversely, a stale entry may point to a deleted passkey.
        // We verify with the server before attempting the full WebAuthn flow
        // to avoid showing the passkey picker for a non-existent credential.
        const lastPasskeyEmail = loadLastPasskeyUser();
        if (!lastPasskeyEmail) {
          console.log('[AutoPasskey] No last passkey user in localStorage — skipping auto-prompt');
          return;
        }

        // Server-side check — authoritative DB query
        const serverHasPasskey = await checkPasskeyExistsOnServer(lastPasskeyEmail);
        if (!serverHasPasskey) {
          console.log('[AutoPasskey] Server confirms no passkey for stored email — clearing and skipping');
          clearLastPasskeyUser();
          return;
        }

        console.log('[AutoPasskey] Attempting auto-prompt for:', lastPasskeyEmail);
        setAutoPromptLoading(true);

        // Fetch authentication options from server
        const optionsResponse = await fetch(`${API_BASE_URL}/api/auth/webauthn/login/options`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: lastPasskeyEmail }),
        });

        if (!optionsResponse.ok) {
          // If no credential for this email, clear the stored email
          if (optionsResponse.status === 409 || optionsResponse.status === 404) {
            console.log('[AutoPasskey] No passkey found for user, clearing stored email');
            clearLastPasskeyUser();
          }
          
          setAutoPromptLoading(false);
          return;
        }

        const optionsData = await optionsResponse.json();

        if (!optionsData.webauthnAvailable || !optionsData.options) {
          console.log('[AutoPasskey] No passkey available for auto-prompt');
          clearLastPasskeyUser();
          setAutoPromptLoading(false);
          return;
        }

        // Create an AbortController so we can cancel if needed
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        // Trigger WebAuthn with conditional UI (browser autofill)
        // This will show the platform authenticator (Face ID, Touch ID, etc.) in the autofill suggestions
        const credential = await startAuthentication({
          optionsJSON: optionsData.options,
          useBrowserAutofill: true,
        });

        // If we get here, user completed biometric authentication
        console.log('[AutoPasskey] Biometric authentication successful');

        // Fetch CSRF token for the verify request
        let autoCsrfToken: string | null = null;
        try {
          const csrfRes = await fetch(`${API_BASE_URL}/api/csrf-token`, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
          });
          if (csrfRes.ok) {
            const csrfData = await csrfRes.json().catch(() => ({}));
            autoCsrfToken = csrfData.csrfToken || csrfData.token || null;
          }
        } catch {
          // non-fatal — CSRF header will be omitted
        }

        const autoVerifyHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        if (autoCsrfToken) {
          autoVerifyHeaders['X-CSRF-Token'] = autoCsrfToken;
          autoVerifyHeaders['x-csrf-token'] = autoCsrfToken;
        }

        // Send credential to server for verification
        const verifyResponse = await fetch(`${API_BASE_URL}/api/auth/webauthn/login/verify`, {
          method: 'POST',
          credentials: 'include',
          headers: autoVerifyHeaders,
          body: JSON.stringify({
            credential,
            rememberMe: true,
          }),
        });

        if (!verifyResponse.ok) {
          const verifyData = await verifyResponse.json().catch(() => ({}));
          showToast(String(verifyData.error ?? 'Biometric authentication failed.'), 'error');
          setAutoPromptLoading(false);
          return;
        }

        const verifyData = await verifyResponse.json();

        // Store auth user data
        if (verifyData.user) {
          writeAuthUser(verifyData.user);
        }

        // Navigate after login (force password change when required)
        const userData = verifyData.user as Record<string, unknown>;
        console.log('[AutoPasskey] Login successful, redirecting');
        navigateAfterLogin(userData);
      } catch (err) {
        // User cancelled or authentication failed
        if (err instanceof Error) {
          if (err.name === 'NotAllowedError') {
            console.log('[AutoPasskey] User cancelled biometric prompt');
          } else if (err.name === 'AbortError') {
            console.log('[AutoPasskey] Auto-prompt aborted');
          } else {
            console.error('[AutoPasskey] Error:', err);
          }
        }
        setAutoPromptLoading(false);
      } finally {
        setAutoPromptAttempted(true);
        setAutoPromptLoading(false);
        abortControllerRef.current = null;
      }
    };

    // Small delay to ensure page is fully rendered
    const timeoutId = setTimeout(() => {
      void attemptAutoPasskeyAuth();
    }, 300);

    return () => {
      clearTimeout(timeoutId);
      // Cleanup abort controller if component unmounts
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [autoPromptAttempted, unverified, reverification, showBiometricModal, showPasskeyPrompt, loading, redirectPath, claimSerial, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnverified(false);
    setReverification(false);
    setReverificationData(null);
    setShowBiometricModal(false);
    setShowPasskeyPrompt(false);
    setBiometricData(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email.trim(),
          password: formData.password,
          rememberMe,
        }),
      });


      let data: Record<string, any> = {};
      try {
        const text = await res.text();
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }
      if (!res.ok) {
        if (res.status === 403 && data.code === 'EMAIL_NOT_VERIFIED') {
          setVerifyUserId(data.userId ? Number(data.userId) : undefined);
          setUnverified(true);
        } else if (res.status === 403 && data.code === 'REVERIFICATION_REQUIRED') {
          setReverificationData({
            userId: data.userId ? Number(data.userId) : undefined,
            email: formData.email.trim(),
            hasWebAuthnCredential: Boolean(data.verificationMethods?.webAuthn ?? data.verificationMethods?.webauthn),
            otpSent: Boolean(data.reverification?.otpSent),
          });
          setReverification(true);
        } else {
          // Prefer explicit message fields, then fallback to status text.
          const msg = data.error ?? data.message ?? res.statusText ?? 'Login failed. Please try again.';
          showToast(msg, 'error');
        }
        return;
      }

      if (data.user) {
        writeAuthUser(data.user);
      }

      if (rememberMe) {
        persistSavedEmail(formData.email.trim());
      } else {
        clearSavedEmail();
      }

      const role = String(data.user?.role ?? data.user?.user_role ?? '').toLowerCase();
      const isCompanyAdmin = role === 'company_admin' || role === 'admin' || role === 'manager';
      const defaultDashboard = isCompanyAdmin ? '/admin/dashboard' : '/user/dashboard';
      const targetPath = resolveLoginTarget(defaultDashboard);

      if (data.user?.requiresPasswordChange === true) {
        sessionStorage.setItem('post_password_change_redirect', targetPath);
        sessionStorage.setItem('post_login_redirect', targetPath);
        router.push('/user/change-password-required');
        return;
      }

      // Placeholder PCO emails: stay on login and complete forced email change + OTP.
      if (data.user?.requiresEmailChange === true) {
        sessionStorage.setItem('post_login_redirect', targetPath);
        setForceEmailCurrent(String(data.user?.email ?? formData.email.trim()));
        setForceEmailChangeOpen(true);
        return;
      }

      // Check if device supports WebAuthn and user has no enrolled passkey yet.
      // If so, offer the passkey enrollment prompt (post-login, non-blocking).
      const hasBiometricCredential = Boolean(data.biometric?.hasCredential);
      const deviceSupportsWebAuthn =
        typeof window !== 'undefined' &&
        Boolean(window.PublicKeyCredential) &&
        Boolean(navigator.credentials);

      if (!hasBiometricCredential && deviceSupportsWebAuthn) {
        // No passkey enrolled yet — show enrollment prompt so the user can
        // register one for future biometric logins.  This is optional; the
        // user can always skip and go straight to the dashboard.
        setShowPasskeyPrompt(true);
        sessionStorage.setItem('post_login_redirect', targetPath);
      } else {
        // User already has a passkey (or WebAuthn not supported) —
        // go directly to the dashboard.  The biometric flow is independent.
        router.push(targetPath);
      }
    } catch {
      showToast('Unable to connect. Please check your internet connection.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleBiometricSuccess = (biometricResponse: Record<string, unknown>) => {
    setShowBiometricModal(false);
    
    // Update auth user data
    if (biometricResponse.user) {
      writeAuthUser(biometricResponse.user);
    }

    // Store this user as the last passkey user for auto-prompt on next visit
    if (formData.email.trim()) {
      persistLastPasskeyUser(formData.email.trim());
    }

    if (rememberMe) {
      persistSavedEmail(formData.email.trim());
    } else {
      clearSavedEmail();
    }

    // Navigate after login (force password change when required)
    const userData = biometricResponse.user as Record<string, unknown>;
    navigateAfterLogin(userData);
  };

  const handleBiometricCancel = () => {
    setShowBiometricModal(false);
    setBiometricData(null);
    
    // User cancelled biometric - they can try password login again
    showToast('Biometric authentication cancelled. You can log in with your password.', 'error');
  };

  const handleBiometricError = (errorMessage: string) => {
    // Error is already displayed in the modal
    // Just log it for debugging
    console.error('Biometric authentication error:', errorMessage);
  };

  const handlePasskeyPromptComplete = () => {
    setShowPasskeyPrompt(false);
    
    // Store this user as the last passkey user for auto-prompt on next visit
    if (formData.email.trim()) {
      persistLastPasskeyUser(formData.email.trim());
    }
    
    const targetPath = sessionStorage.getItem('post_login_redirect') || '/user/dashboard';
    sessionStorage.removeItem('post_login_redirect');
    router.push(targetPath);
  };

  const handlePasskeyPromptSkip = () => {
    setShowPasskeyPrompt(false);
    const targetPath = sessionStorage.getItem('post_login_redirect') || '/user/dashboard';
    sessionStorage.removeItem('post_login_redirect');
    router.push(targetPath);
  };

  /**
   * Manual biometric login button handler
   * Allows users to trigger biometric authentication directly from the login page
   */
  const handleManualBiometricLogin = async () => {
    setLoading(true);

    try {
      const lastPasskeyEmail = loadLastPasskeyUser();
      if (!lastPasskeyEmail) {
        showToast('No passkey found for this device. Please log in with your password.', 'error');
        setLoading(false);
        return;
      }

      // Check if WebAuthn is supported
      if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials) {
        showToast('Your browser does not support biometric authentication.', 'error');
        setLoading(false);
        return;
      }

      // Fetch authentication options from server
      const optionsResponse = await fetch(`${API_BASE_URL}/api/auth/webauthn/login/options`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: lastPasskeyEmail }),
      });

      if (!optionsResponse.ok) {
        const optionsData = await optionsResponse.json().catch(() => ({}));
        
        if (optionsResponse.status === 409 || optionsResponse.status === 404) {
          clearLastPasskeyUser();
          showToast('No passkey found. Please log in with your password.', 'error');
        } else {
          showToast(String(optionsData.error ?? 'Unable to start biometric authentication.'), 'error');
        }
        setLoading(false);
        return;
      }

      const optionsData = await optionsResponse.json();

      if (!optionsData.webauthnAvailable || !optionsData.options) {
        clearLastPasskeyUser();
        showToast('No passkey available. Please log in with your password.', 'error');
        setLoading(false);
        return;
      }

      // Trigger WebAuthn authentication
      const credential = await startAuthentication({
        optionsJSON: optionsData.options,
      });

      // Build headers with CSRF token
      const csrfTokenResponse = await fetch(`${API_BASE_URL}/api/csrf-token`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });

      let csrfToken: string | null = null;
      if (csrfTokenResponse.ok) {
        const csrfData = await csrfTokenResponse.json().catch(() => ({}));
        csrfToken = csrfData.csrfToken || csrfData.token || null;
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
        headers['x-csrf-token'] = csrfToken;
      }

      // Send credential to server for verification
      const verifyResponse = await fetch(`${API_BASE_URL}/api/auth/webauthn/login/verify`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          credential,
          rememberMe: true,
        }),
      });

      if (!verifyResponse.ok) {
        const verifyData = await verifyResponse.json().catch(() => ({}));
        showToast(String(verifyData.error ?? 'Biometric authentication failed.'), 'error');
        setLoading(false);
        return;
      }

      const verifyData = await verifyResponse.json();

      // Store auth user data
      if (verifyData.user) {
        writeAuthUser(verifyData.user);
      }

      // Navigate after login (force password change when required)
      const userData = verifyData.user as Record<string, unknown>;
      navigateAfterLogin(userData);
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError') {
          showToast('Biometric authentication was cancelled.', 'error');
        } else if (err.name === 'InvalidStateError') {
          showToast('Your biometric credential is no longer valid.', 'error');
        } else {
          showToast('Biometric authentication failed. Please try again or use your password.', 'error');
        }
      } else {
        showToast('Biometric authentication failed. Please use your password.', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Right-panel content switches between login form and OTP verify ──
  const rightContent = reverification && reverificationData ? (
    <ReverificationChallengeUser
      email={reverificationData.email}
      userId={reverificationData.userId}
      hasWebAuthnCredential={reverificationData.hasWebAuthnCredential}
      otpSent={reverificationData.otpSent}
      onCompleted={() => {
        setReverification(false);
        setReverificationData(null);
        router.push(resolveLoginTarget('/user/dashboard'));
      }}
      onBack={() => {
        setReverification(false);
        setReverificationData(null);
      }}
    />
  ) : unverified ? (
    <VerifyEmailUser
      email={formData.email}
      userId={verifyUserId}
      onVerified={() => {
        setUnverified(false);
        router.push('/user/dashboard');
      }}
      onBack={() => setUnverified(false)}
    />
  ) : (
    <div className='w-full max-w-sm animate-fade-in-up'>
      <div className='mb-5 flex justify-center'>
        <img
          src="/ontaplogo.svg"
          alt="OnTap Logo"
          width={225}
          height={110}
          className="h-12 w-auto max-w-full object-contain"
          draggable={false}
          decoding="async"
        />
      </div>

      {/* Header tabs */}
      <div className='flex items-center gap-4 mb-2 justify-center'>
        <h1 className='text-2xl font-bold text-gray-900 relative after:absolute after:-bottom-1 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-[#2D3A8C]'>
          Log in
        </h1>
        <div className='w-px h-6 bg-gray-300' aria-hidden="true" />
        <Link
          href={signupHref}
          className='text-2xl font-semibold text-gray-400 hover:text-gray-700 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D3A8C]/40 focus-visible:ring-offset-2 rounded-sm'
        >
          SignUp
        </Link>
      </div>
      <p className='text-gray-400 text-sm mb-7 text-center'>Sign in to access your Ontap account</p>

      {claimSerial ? (
        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700 text-center">
          Claiming BizCard <span className="font-semibold tracking-wider">{claimSerial}</span>. After you sign in,
          you can merge it with a virtual card or create a separate one.
        </div>
      ) : null}

      {/* Auto-prompt loading indicator */}
      {autoPromptLoading && (
        <div className="mb-4 flex items-center justify-center gap-2 bg-blue-50 border border-blue-200 text-blue-700 text-sm rounded-xl px-4 py-3">
          <InlineLoader />
          <span>Checking for biometric authentication...</span>
        </div>
      )}

      <form className="space-y-5" onSubmit={handleSubmit}>
        {/* Email */}
        <div>
          <label className='block text-sm font-semibold text-gray-700 mb-2'>Email Address</label>
          <div className='relative'>
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none transition-colors" />
            <input
              type="email"
              placeholder="your email address..."
              value={formData.email}
              onChange={(e) => { setFormData({ ...formData, email: e.target.value }); }}
              className='w-full pl-11 pr-4 py-3 border border-gray-300 rounded-xl text-sm bg-white focus:outline-none focus:border-[#2D3A8C] focus:ring-2 focus:ring-[#2D3A8C]/20 transition-all duration-200'
              required
              autoComplete="email"
            />
          </div>
        </div>

        
        {/* Password */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Password</label>
          <div className='relative'>
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none" />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder='Your Password'
              value={formData.password}
              onChange={(e) => { setFormData({ ...formData, password: e.target.value }); }}
              className='w-full pl-11 pr-11 py-3 border border-gray-300 rounded-xl text-sm bg-white focus:outline-none focus:border-[#2D3A8C] focus:ring-2 focus:ring-[#2D3A8C]/20 transition-all duration-200'
              required
              autoComplete="current-password"
            />
            <button
              type='button'
              onClick={() => setShowPassword(!showPassword)}
              className='absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D3A8C]/40 rounded'
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className='h-5 w-5' /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {/* Remember me & Forgot password */}
        <div className='flex items-center justify-between'>
          <label className='flex items-center gap-2 cursor-pointer'>
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => { setRememberMe(e.target.checked); if (!e.target.checked) { clearSavedEmail(); } }}
              className='w-4 h-4 border border-gray-300 rounded accent-blue-600'
            />
            <span className='text-sm text-gray-700'>Remember me</span>
          </label>
          <Link
            href="/user/forgot-password"
            className='text-sm text-blue-500 hover:text-blue-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D3A8C]/40 focus-visible:ring-offset-1 rounded-sm'
          >
            Forgot password?
          </Link>
        </div>
        {/* Login button */}
        <button
          type='submit'
          disabled={loading}
          className='w-full flex items-center justify-center gap-2 bg-[#2D3A8C] hover:bg-[#243080] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-all duration-300 text-base cursor-pointer hover:shadow-lg hover:shadow-blue-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D3A8C]/50 focus-visible:ring-offset-2'
        >
          {loading ? <><InlineLoader /> Logging in...</> : 'Log in'}
        </button>

        {/* Biometric Login Button (shown if passkey is available) */}
        {hasBiometricCapability && !checkingBiometricAvailability && (
          <button
            type='button'
            onClick={handleManualBiometricLogin}
            disabled={loading}
            className='w-full flex items-center justify-center gap-2 bg-white hover:bg-gray-50 border-2 border-[#2D3A8C] disabled:opacity-60 disabled:cursor-not-allowed text-[#2D3A8C] font-semibold py-3.5 rounded-xl transition-all duration-300 text-base cursor-pointer hover:shadow-lg hover:shadow-blue-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D3A8C]/50 focus-visible:ring-offset-2'
          >
            <Fingerprint className="h-5 w-5" />
            {loading ? 'Authenticating...' : 'Login with Biometrics'}
          </button>
        )}
      </form>
    </div>  
  );


return (
    <main className="min-h-screen w-full flex flex-col items-center justify-center bg-[#ECEEF5] px-4 py-10">
      {/* ── Biometric Authentication Modal ── */}
      {showBiometricModal && biometricData && (
        <BiometricLoginModal
          email={biometricData.email}
          rememberMe={rememberMe}
          onSuccess={handleBiometricSuccess}
          onCancel={handleBiometricCancel}
          onError={handleBiometricError}
        />
      )}
      {/* ── Passkey Enrollment Prompt (shown after first password login) ── */}
      {showPasskeyPrompt && (
        <PasskeyPrompt
          onComplete={handlePasskeyPromptComplete}
          onSkip={handlePasskeyPromptSkip}
        />
      )}

      {/* ── Contained login card ── */}
      <div
        className="w-full max-w-4xl flex flex-col md:flex-row rounded-2xl overflow-hidden shadow-2xl border border-gray-200/60 md:min-h-[600px]"
      >
      <div
        className="hidden md:flex md:w-[42%] relative overflow-hidden flex-col"
        style={{ background: 'linear-gradient(145deg, #0c1847 0%, #162666 30%, #1e2f82 60%, #2A4792 85%, #3a5fa8 100%)' }}
      >
        {/* Ambient glow blobs */}
        <div
          className="animate-blob absolute -top-16 -right-12 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(71,133,184,0.45) 0%, transparent 70%)' }}
        />

        <div
          className="animate-blob-d3 absolute bottom-28 -left-10 w-72 h-72 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(42,71,146,0.55) 0%, transparent 70%)' }}
        />
        <div
          className="animate-blob-d6 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-105 h-105 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(20,40,110,0.35) 0%, transparent 65%)' }}
        />
        {/* Person — fills the full panel height (LCP image) */}
        <Image
          src="/loginpageimage.jpg"
          alt="Professional with phone"
          fill
          priority
          sizes="(max-width: 768px) 0px, 42vw"
          className="animate-phone-glow object-cover object-center select-none pointer-events-none"
          style={{ zIndex: 8 }}
          draggable={false}
        />
        
        <div
          className="absolute bottom-0 left-0 right-0 h-48 pointer-events-none"
          style={{ background: 'linear-gradient(to top, rgba(10,22,70,0.88) 0%, rgba(10,22,70,0.45) 45%, transparent 100%)', zIndex: 9 }}
        />

        {/* Product message */}
        <div
          className="absolute bottom-5 left-5 right-5 animate-login-copy-in pointer-events-none"
          style={{ zIndex: 28 }}
        >
          <p className="text-white text-xl font-semibold tracking-tight drop-shadow-sm">
            Tap. Connect. Grow.
          </p>
          <p className="text-white/75 text-sm mt-1">
            Your digital identity, one tap away.
          </p>
        </div>

      </div>
      <div className="flex-1 flex items-center justify-center px-6 py-8 sm:px-10 sm:py-10 bg-white"
      style={{
          backgroundImage: [
            'radial-gradient(circle at top left, rgba(71,133,184,0.18) 0%, transparent 34%)',
            'radial-gradient(circle at 85% 18%, rgba(42,71,146,0.12) 0%, transparent 26%)',
            'radial-gradient(circle at bottom right, rgba(71,133,184,0.10) 0%, transparent 30%)',
            'linear-gradient(180deg, #f7f9fe 0%, #eef2fa 38%, #f8faff 100%)',
          ].join(', '),
        }}
      >
        <div className="w-full max-w-sm">
          {rightContent}
        </div>
      </div>

      </div>{/* end card */}

      {/* Footer */}
      <p className="mt-7 text-xs text-gray-400 tracking-wide">
        All Rights Reserved &copy; 2026{' '}
        <span className="text-primary font-semibold">Ontap Creatives</span>
      </p>

      <ForceChangeEmailModal
        open={forceEmailChangeOpen}
        currentEmail={forceEmailCurrent || formData.email.trim()}
        onCompleted={(newEmail) => {
          setForceEmailChangeOpen(false);
          setForceEmailCurrent(newEmail);
          setFormData((prev) => ({ ...prev, email: newEmail }));
          try {
            const raw = window.localStorage.getItem('authUser');
            if (raw) {
              const parsed = JSON.parse(raw) as Record<string, unknown>;
              parsed.email = newEmail;
              parsed.requiresEmailChange = false;
              window.localStorage.setItem('authUser', JSON.stringify(parsed));
            }
          } catch {
            // ignore localStorage errors
          }

          const role = (() => {
            try {
              const raw = window.localStorage.getItem('authUser');
              if (!raw) return '';
              const parsed = JSON.parse(raw) as Record<string, unknown>;
              return String(parsed.role ?? parsed.user_role ?? '').toLowerCase();
            } catch {
              return '';
            }
          })();
          const isCompanyAdmin = role === 'company_admin' || role === 'admin' || role === 'manager';
          const defaultDashboard = isCompanyAdmin ? '/admin/dashboard' : '/user/dashboard';
          const targetPath =
            sessionStorage.getItem('post_login_redirect') || resolveLoginTarget(defaultDashboard);
          sessionStorage.removeItem('post_login_redirect');
          router.push(targetPath);
        }}
      />

    </main>
  );
};

export default LoginUser;
