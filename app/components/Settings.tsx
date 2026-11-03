'use client';

import React, { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { 
  User,
  Lock,
  Mail,
  Bell,
  History,
  Camera,
  ChevronRight,
  Receipt,
  X,
  Shield,
  LogOut,
  Fingerprint,
  Trash2,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import { InlineLoader } from './Loader';
import { ModalPortal } from './ModalPortal';
import { startRegistration } from '@simplewebauthn/browser';
import { motion } from 'framer-motion';
import { getFrontendApiBaseUrl } from './apiBase';
import { showToast } from './Toast';
import { showConfirmDialog } from './ConfirmDialog';
import { buildImpersonationHeaders } from '@/app/lib/superadminImpersonationHandoff';
import { toServableMediaSrc } from '../lib/portfolioDisplay';
import { ProfileImageCropModal } from './ProfileImageCropModal';

const API = getFrontendApiBaseUrl();
const USER_SYNC_EVENT = 'ontap:user-sync';
const CSRF_COOKIE_NAME = 'csrf-token';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_PROFILE_UPLOAD_BYTES = Math.floor(4.5 * 1024 * 1024);

type AccountFormState = {
  firstName: string;
  lastName: string;
  email: string;
  altEmail: string;
  phone: string;
  profileImage: string;
};

type PasswordFormState = {
  current: string;
  new: string;
  confirm: string;
};

type EmailFormState = {
  new: string;
  confirm: string;
};

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: unknown;
  message?: string;
  details?: unknown;
};

type UserProfilePayload = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  alternative_email?: string | null;
  phone_number?: string | null;
  profile_image?: string | null;
};

type GradientButtonProps = {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
};

type GradientBorderCardProps = {
  children: React.ReactNode;
  className?: string;
};

type InputFieldProps = {
  label: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  icon?: LucideIcon;
};

type ToggleSwitchProps = {
  enabled: boolean;
  onChange: (value: boolean) => void;
  label: string;
  subLabel: string;
  disabled?: boolean;
};

type NotificationToggleState = {
  email: boolean;
  inquiry: boolean;
  qr: boolean;
  promo: boolean;
  updates: boolean;
};

type EventPreference = {
  in_app?: boolean;
  email?: boolean;
  digest?: boolean;
  push?: boolean;
};

type NotificationPreferencesPayload = {
  preferences?: Record<string, EventPreference>;
  email_notifications_enabled?: boolean;
  unsubscribed_at?: string | null;
};

type BillingTransaction = {
  id: string;
  source: 'purchase_log' | 'subscription_log';
  type: 'subscription' | 'physical_card' | 'theme' | 'subscription_change';
  description: string;
  amount: number;
  currency: string;
  formatted_amount: string;
  status: string;
  date: string;
  receipt_url: string;
  metadata?: {
    upgrade_type?: string;
    bizcard_serial?: string | null;
    from_plan?: string | null;
    to_plan?: string | null;
    order_number?: string | null;
  } | null;
};

type BillingPagination = {
  page: number;
  limit: number;
  total: number;
  pages: number;
};

type BillingReceiptItem = {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
};

type BillingReceiptDetail = {
  receipt_id: string;
  transaction_id: string;
  date: string;
  status: string;
  currency: string;
  total: number;
  formatted_total: string;
  invoice_number: string;
  items: BillingReceiptItem[];
  subtotal: number;
  tax: number;
  shipping?: number;
  discount?: number;
  customer?: { name: string; email: string };
  payment_method?: { type: string };
  event_type?: string;
  subscription?: {
    bizcard_serial: string | null;
    billing_cycle: string | null;
    from_plan: { id: string; name: string } | null;
    to_plan: { id: string; name: string };
    effective_date: string;
    expiry_date: string | null;
  };
  order?: {
    order_number: string;
    subtotal?: number;
    tax?: number;
    shipping?: number;
    discount?: number;
    total?: number;
  };
};

const DEFAULT_NOTIFICATION_TOGGLES: NotificationToggleState = {
  email: true,
  inquiry: true,
  qr: true,
  promo: false,
  updates: true,
};

function readEventPref(
  prefs: Record<string, EventPreference>,
  key: string,
): EventPreference {
  return prefs[key] ?? {};
}

function isCategoryEnabled(pref: EventPreference): boolean {
  return (
    pref.in_app === true ||
    pref.email === true ||
    pref.digest === true ||
    pref.push === true
  );
}

function preferencesFromApi(
  apiPrefs: Record<string, EventPreference>,
  emailNotificationsEnabled: boolean,
): NotificationToggleState {
  return {
    email: emailNotificationsEnabled,
    inquiry: isCategoryEnabled(readEventPref(apiPrefs, 'inquiry_sent')),
    qr: isCategoryEnabled(readEventPref(apiPrefs, 'profile_view')),
    promo: readEventPref(apiPrefs, 'promotional').email === true,
    updates: isCategoryEnabled(readEventPref(apiPrefs, 'system_update')),
  };
}

function buildCategoryPref(enabled: boolean, masterEmailOn: boolean): EventPreference {
  if (!enabled) {
    return { in_app: false, email: false, digest: false, push: false };
  }
  return {
    in_app: true,
    email: masterEmailOn,
    digest: false,
    push: false,
  };
}

function buildNotificationPreferencesPayload(toggles: NotificationToggleState): {
  email_notifications_enabled: boolean;
  preferences: Record<string, EventPreference>;
} {
  return {
    email_notifications_enabled: toggles.email,
    preferences: {
      inquiry_sent: buildCategoryPref(toggles.inquiry, toggles.email),
      profile_view: buildCategoryPref(toggles.qr, toggles.email),
      system_update: buildCategoryPref(toggles.updates, toggles.email),
      promotional: toggles.promo
        ? { in_app: false, email: true, digest: false, push: false }
        : { in_app: false, email: false, digest: false, push: false },
    },
  };
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie ? document.cookie.split('; ') : [];
  for (const cookie of cookies) {
    const [rawKey, ...rest] = cookie.split('=');
    const key = decodeURIComponent(rawKey || '').trim();
    if (key !== name) continue;
    return decodeURIComponent(rest.join('=') || '').trim() || null;
  }
  return null;
}

function dispatchUserSync(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(USER_SYNC_EVENT));
}

function resolveMediaUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  const servable = toServableMediaSrc(value);
  if (/^https?:\/\//i.test(servable)) return servable;
  if (servable.startsWith('/')) return `${API}${servable}`;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `${API}${value}`;
  return value;
}

function getInitials(name: string, email: string): string {
  const normalized = name.trim();
  if (normalized) {
    return normalized
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  const mail = email.trim();
  if (mail) return mail[0].toUpperCase();
  return 'DR';
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const raw = payload as Record<string, unknown>;

  const fromError = typeof raw.error === 'string' ? raw.error.trim() : '';
  const fromErrorObject =
    raw.error && typeof raw.error === 'object'
      ? String((raw.error as Record<string, unknown>).message ?? '').trim()
      : '';
  const fromMessage = typeof raw.message === 'string' ? raw.message.trim() : '';

  const details = Array.isArray(raw.details)
    ? raw.details.map((item) => String(item)).join(' ').trim()
    : '';

  const primary = fromError || fromErrorObject || fromMessage;
  if (primary && details) return `${primary} ${details}`.trim();
  if (primary) return primary;
  if (details) return details;
  return fallback;
}

function formatBillingDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function billingTypeLabel(type: BillingTransaction['type']): string {
  switch (type) {
    case 'subscription':
      return 'Subscription';
    case 'theme':
      return 'Theme';
    case 'physical_card':
      return 'Product';
    case 'subscription_change':
      return 'Plan Change';
    default:
      return 'Transaction';
  }
}

function billingStatusClasses(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'pending':
    case 'scheduled':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'failed':
    case 'cancelled':
      return 'bg-red-50 text-red-700 border-red-200';
    case 'refunded':
      return 'bg-gray-100 text-gray-700 border-gray-200';
    default:
      return 'bg-gray-50 text-gray-600 border-gray-200';
  }
}

function normalizeAccountForm(form: AccountFormState): AccountFormState {
  return {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    email: form.email.trim().toLowerCase(),
    altEmail: form.altEmail.trim().toLowerCase(),
    phone: form.phone.trim(),
    profileImage: form.profileImage.trim(),
  };
}

function patchAuthUser(patch: Record<string, unknown>, dispatchNow = true): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem('authUser');
    const existing = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const merged = { ...existing, ...patch };

    const first = String(merged.firstName ?? merged.first_name ?? '').trim();
    const last = String(merged.lastName ?? merged.last_name ?? '').trim();
    const fullFallback = String(merged.fullName ?? merged.full_name ?? merged.name ?? '').trim();
    const fullName = [first, last].filter(Boolean).join(' ').trim() || fullFallback;

    merged.firstName = first;
    merged.lastName = last;
    merged.fullName = fullName;

    localStorage.setItem('authUser', JSON.stringify(merged));
  } catch {
    // ignore localStorage serialization issues
  }

  if (dispatchNow) dispatchUserSync();
}

async function ensureCsrfToken(): Promise<string | null> {
  const fromCookie = readCookie(CSRF_COOKIE_NAME);
  if (fromCookie) return fromCookie;

  try {
    const response = await fetch(`${API}/api/csrf-token`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });

    if (!response.ok) return readCookie(CSRF_COOKIE_NAME);

    const payload = (await response.json()) as Record<string, unknown>;
    const data = payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : null;

    const token =
      (typeof payload.csrfToken === 'string' && payload.csrfToken) ||
      (typeof payload.csrf_token === 'string' && payload.csrf_token) ||
      (typeof payload.token === 'string' && payload.token) ||
      (data && typeof data.csrfToken === 'string' && data.csrfToken) ||
      null;

    return token?.trim() || readCookie(CSRF_COOKIE_NAME);
  } catch {
    return readCookie(CSRF_COOKIE_NAME);
  }
}

async function authFetch(url: string, init: RequestInit = {}, canRetry = true): Promise<Response> {
  const method = String(init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers ?? undefined);

  if (MUTATING_METHODS.has(method)) {
    const csrfToken = await ensureCsrfToken();
    if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  }

  // Add impersonation headers if present
  const impersonationHeaders = buildImpersonationHeaders();
  Object.entries(impersonationHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });

  const requestInit: RequestInit = {
    credentials: 'include',
    cache: 'no-store',
    ...init,
    method,
    headers,
  };

  const response = await fetch(url, requestInit);

  if (canRetry && (response.status === 401 || response.status === 403)) {
    const refreshHeaders = new Headers();
    const refreshToken = await ensureCsrfToken();
    if (refreshToken) refreshHeaders.set('X-CSRF-Token', refreshToken);

    const refreshResponse = await fetch(`${API}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        ...Object.fromEntries(refreshHeaders.entries()),
        ...buildImpersonationHeaders(),
      },
    });

    if (refreshResponse.ok) return fetch(url, requestInit);
  }

  return response;
}

type UserSessionRow = {
  session_id: string;
  device_type: string | null;
  browser: string | null;
  os: string | null;
  ip_address: string | null;
  location: string | null;
  created_at: string;
  last_activity: string | null;
  is_current: boolean;
};

function formatSessionWhen(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function SecuritySessionsPanel() {
  const [sessions, setSessions] = useState<UserSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${API}/api/user/sessions`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'Failed to load sessions');
      }
      setSessions(Array.isArray(json.data?.sessions) ? json.data.sessions : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const revokeSession = async (sessionId: string) => {
    setActionId(sessionId);
    setError(null);
    try {
      const res = await authFetch(`${API}/api/user/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'Failed to log out session');
      }
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log out session');
    } finally {
      setActionId(null);
    }
  };

  const revokeOthers = async () => {
    setActionId('others');
    setError(null);
    try {
      const res = await authFetch(`${API}/api/user/sessions/revoke-others`, { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'Failed to log out other devices');
      }
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log out other devices');
    } finally {
      setActionId(null);
    }
  };

  const otherSessions = sessions.filter((session) => !session.is_current);

  return (
    <div className="w-full min-w-0 bg-white p-4 sm:p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <h3 className="text-base sm:text-lg font-semibold text-gray-800 flex items-center gap-2">
          <Shield className="w-5 h-5 shrink-0 text-[#2D3A8C]" /> Active Sessions
        </h3>
        {otherSessions.length > 0 && (
          <button
            type="button"
            onClick={() => void revokeOthers()}
            disabled={actionId !== null}
            className="self-start text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-60"
          >
            {actionId === 'others' ? 'Logging out…' : 'Log out all other devices'}
          </button>
        )}
      </div>
      <p className="text-sm text-gray-500">Review active sessions and sign out devices you no longer use.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-gray-500 inline-flex items-center gap-2">
          <InlineLoader /> Loading sessions…
        </p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-gray-500">No active sessions found.</p>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.session_id}
              className="flex flex-col gap-3 rounded-lg border border-gray-100 px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-4"
            >
              <div className="min-w-0 break-words">
                <p className="text-sm font-medium text-gray-800">
                  {[session.browser, session.os].filter(Boolean).join(' on ') || session.device_type || 'Unknown device'}
                  {session.is_current && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-emerald-600">Current</span>
                  )}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {session.ip_address || 'Unknown IP'}
                  {session.location ? ` · ${session.location}` : ''}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Last activity: {formatSessionWhen(session.last_activity || session.created_at)}
                </p>
              </div>
              {!session.is_current && (
                <button
                  type="button"
                  onClick={() => void revokeSession(session.session_id)}
                  disabled={actionId !== null}
                  className="inline-flex min-h-10 items-center justify-center gap-1 self-start text-xs font-medium text-gray-600 hover:text-red-600 disabled:opacity-60 shrink-0 sm:min-h-0"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  {actionId === session.session_id ? '…' : 'Log out'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type PasskeyCredential = {
  id: number;
  credentialId: string;
  credentialName: string;
  deviceType: string | null;
  backedUp: boolean;
  transports: string[];
  lastUsedAt: string | null;
  createdAt: string;
};

function PasskeyManagementPanel() {
  const [passkeys, setPasskeys] = useState<PasskeyCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<number | string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);

  const loadPasskeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${API}/api/user/passkeys`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'Failed to load passkeys');
      }
      setPasskeys(Array.isArray(json.data?.credentials) ? json.data.credentials : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load passkeys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPasskeys();
  }, [loadPasskeys]);

  const handleEnrollPasskey = async () => {
    setEnrolling(true);
    setEnrollError(null);

    try {
      // Check WebAuthn support
      if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials) {
        throw new Error('Your browser does not support passkey authentication.');
      }

      // Fetch registration options
      const optionsRes = await authFetch(`${API}/api/auth/webauthn/register/options`, {
        method: 'POST',
      });

      if (!optionsRes.ok) {
        const optionsData = await optionsRes.json().catch(() => ({}));
        throw new Error(optionsData.error ?? 'Unable to start passkey registration.');
      }

      const optionsData = await optionsRes.json();

      // Start WebAuthn registration ceremony
      const credential = await startRegistration(optionsData.options);

      // Verify and store credential
      const verifyRes = await authFetch(`${API}/api/auth/webauthn/register/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      });

      if (!verifyRes.ok) {
        const verifyData = await verifyRes.json().catch(() => ({}));
        throw new Error(verifyData.error ?? 'Passkey registration failed.');
      }

      // Store the current user email as last passkey user for auto-prompt
      try {
        const authUserStr = localStorage.getItem('authUser');
        if (authUserStr) {
          const authUser = JSON.parse(authUserStr) as Record<string, unknown>;
          const email = String(authUser.email ?? '').trim();
          if (email) {
            localStorage.setItem('lastPasskeyUser', email.toLowerCase());
          }
        }
      } catch {
        // Non-fatal error
      }

      // Reload passkeys list
      await loadPasskeys();
    } catch (err) {
      console.error('Passkey enrollment error:', err);

      if (err instanceof Error) {
        if (err.name === 'NotAllowedError') {
          setEnrollError('Registration was cancelled. You can try again later.');
        } else if (err.name === 'InvalidStateError') {
          setEnrollError('This device already has a passkey registered.');
          await loadPasskeys();
        } else {
          setEnrollError(err.message || 'Unable to register passkey. Please try again later.');
        }
      } else {
        setEnrollError('An unexpected error occurred during passkey registration.');
      }
    } finally {
      setEnrolling(false);
    }
  };

  const handleDeletePasskey = async (credentialId: string, credentialName: string) => {
    const confirmed = await showConfirmDialog({
      title: "Remove this passkey?",
      message: `"${credentialName}" will be removed from your account. You can still sign in with your password or another passkey.`,
      confirmLabel: "Remove passkey",
      variant: "danger",
    });
    if (!confirmed) {
      return;
    }

    setActionId(credentialId);
    setError(null);

    try {
      const res = await authFetch(`${API}/api/user/passkeys/${encodeURIComponent(credentialId)}`, {
        method: 'DELETE',
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        if (json?.code === 'LAST_AUTH_METHOD') {
          throw new Error('Cannot delete your last passkey. Please set a password first or add another passkey.');
        }
        throw new Error(json?.error || 'Failed to remove passkey');
      }

      await loadPasskeys();
      
      // If no passkeys remain, clear the last passkey user
      const updatedList = await authFetch(`${API}/api/user/passkeys`).then(r => r.json()).catch(() => ({ data: { credentials: [] } }));
      if (!Array.isArray(updatedList.data?.credentials) || updatedList.data.credentials.length === 0) {
        try {
          localStorage.removeItem('lastPasskeyUser');
        } catch {
          // Non-fatal
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove passkey');
    } finally {
      setActionId(null);
    }
  };

  const formatPasskeyDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getDeviceIcon = (deviceType: string | null) => {
    if (deviceType === 'multiDevice') return '☁️';
    return '🔐';
  };

  return (
    <div className="w-full min-w-0 bg-white p-4 sm:p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <h3 className="text-base sm:text-lg font-semibold text-gray-800 flex items-center gap-2">
          <Fingerprint className="w-5 h-5 shrink-0 text-[#2D3A8C]" /> Passkeys
        </h3>
        <button
          type="button"
          onClick={() => void handleEnrollPasskey()}
          disabled={enrolling || loading}
          className="inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-[#2D3A8C] hover:text-[#1c2763] disabled:opacity-60 bg-[#2D3A8C]/5 hover:bg-[#2D3A8C]/10 px-3 py-1.5 rounded-lg transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          {enrolling ? 'Adding…' : 'Add passkey'}
        </button>
      </div>
      
      <p className="text-sm text-gray-500">
        Passkeys use Face ID, Touch ID, fingerprint, or Windows Hello for secure, password-free login.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {enrollError && <p className="text-sm text-red-600">{enrollError}</p>}

      {loading ? (
        <p className="text-sm text-gray-500 inline-flex items-center gap-2">
          <InlineLoader /> Loading passkeys…
        </p>
      ) : passkeys.length === 0 ? (
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-6 text-center">
          <Fingerprint className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-600 font-medium mb-1">No passkeys enrolled</p>
          <p className="text-xs text-gray-500">
            Add a passkey to enable fast, secure biometric login on this device.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {passkeys.map((passkey) => (
            <div
              key={passkey.id}
              className="flex flex-col gap-3 rounded-lg border border-gray-100 px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-4"
            >
              <div className="min-w-0 flex-1 break-words">
                <div className="flex items-center gap-2">
                  <span className="text-base">{getDeviceIcon(passkey.deviceType)}</span>
                  <p className="text-sm font-medium text-gray-800">
                    {passkey.credentialName}
                  </p>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Created: {formatPasskeyDate(passkey.createdAt)}
                  {passkey.lastUsedAt && ` · Last used: ${formatPasskeyDate(passkey.lastUsedAt)}`}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  {passkey.backedUp && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                      ☁️ Synced
                    </span>
                  )}
                  {passkey.transports.length > 0 && (
                    <span className="text-[10px] text-gray-400">
                      {passkey.transports.map(t => t.toUpperCase()).join(', ')}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleDeletePasskey(passkey.credentialId, passkey.credentialName)}
                disabled={actionId !== null || enrolling}
                className="inline-flex min-h-10 items-center justify-center gap-1 self-start text-xs font-medium text-gray-600 hover:text-red-600 disabled:opacity-60 shrink-0 sm:min-h-0"
                title="Remove this passkey"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {actionId === passkey.credentialId ? '…' : 'Remove'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-500 leading-relaxed">
          Your biometric data never leaves your device. We only store a secure cryptographic key that works exclusively with your registered device.
        </p>
      </div>
    </div>
  );
}

// --- Shared Components ---

const GradientButton = ({
  children,
  onClick,
  className = '',
  disabled = false,
  type = 'button',
}: GradientButtonProps) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    className={`bg-gradient-to-r from-[#20316B] via-[#2D3A8C] to-[#425BB5] hover:opacity-90 text-white font-medium min-h-11 py-2.5 px-6 rounded-lg transition-all shadow-md disabled:opacity-50 ${className}`}
  >
    {children}
  </button>
);



const GradientBorderCard = ({ children, className = '' }: GradientBorderCardProps) => (
  <div className={`relative p-px rounded-xl bg-linear-to-r from-[#20316B] via-[#2D3A8C] to-[#425BB5] ${className}`}>
    <div className="bg-white rounded-xl h-full w-full p-6 relative z-10">
      {children}
    </div>
  </div>
);



const InputField = ({ label, type = 'text', placeholder, value, onChange, icon: Icon }: InputFieldProps) => (
  <div className="min-w-0 space-y-1.5">
    <label className="text-sm font-semibold text-gray-600">{label}</label>
    <div className="relative">
      <input
        type={type}
        className={`w-full min-w-0 max-w-full px-4 py-3 sm:py-2.5 border border-gray-200 rounded-lg text-base sm:text-sm focus:outline-none focus:border-[#2D3A8C] focus:ring-1 focus:ring-[#2D3A8C] transition-colors ${
          Icon ? 'pl-10' : 'pl-4'
        }`}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
      />
      {Icon && <Icon className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />}
    </div>
  </div>
);



const ToggleSwitch = ({ enabled, onChange, label, subLabel, disabled = false }: ToggleSwitchProps) => (
  <div className="flex items-start sm:items-center justify-between gap-3 p-3 sm:p-4 bg-gray-50 rounded-lg border border-gray-100 min-w-0">
    <div className="min-w-0 break-words">
      <h4 className="text-sm font-medium text-gray-800">{label}</h4>
      <p className="text-xs text-gray-400 mt-0.5">{subLabel}</p>
    </div>
    <button
      type="button"
      aria-pressed={enabled}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
        enabled ? 'bg-[#2D3A8C]' : 'bg-gray-300'
      }`}
    >
      <span
        className={`${
          enabled ? 'translate-x-6' : 'translate-x-1'
        } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
      />
    </button>
  </div>
);
// --- Settings Component ---
const Settings = () => {
  const [activeTab, setActiveTab] = useState<'account' | 'billing'>('account');
  const [savingChanges, setSavingChanges] = useState(false);
  const [accountLoading, setAccountLoading] = useState(true);
  const [profileUploading, setProfileUploading] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [emailForm, setEmailForm] = useState<EmailFormState>({ new: '', confirm: '' });
  const [emailError, setEmailError] = useState<string | null>(null);
  const [savingEmail, setSavingEmail] = useState(false);
  const [profilePreview, setProfilePreview] = useState<string | null>(null);
  const [profileDragActive, setProfileDragActive] = useState(false);
  const [profileCropFile, setProfileCropFile] = useState<File | null>(null);
  const profileInputRef = useRef<HTMLInputElement | null>(null);

  // -- Account State --
  const [accountForm, setAccountForm] = useState<AccountFormState>({
    firstName: '',
    lastName: '',
    email: '',
    altEmail: '',
    phone: '',
    profileImage: '',
  });
  const [initialAccountForm, setInitialAccountForm] = useState<AccountFormState>({
    firstName: '',
    lastName: '',
    email: '',
    altEmail: '',
    phone: '',
    profileImage: '',
  });
  const [passwordForm, setPasswordForm] = useState<PasswordFormState>({ current: '', new: '', confirm: '' });
  const [notifications, setNotifications] = useState<NotificationToggleState>(DEFAULT_NOTIFICATION_TOGGLES);
  const [initialNotifications, setInitialNotifications] =
    useState<NotificationToggleState>(DEFAULT_NOTIFICATION_TOGGLES);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [savingNotifications, setSavingNotifications] = useState(false);
  // Debounce timer ref so rapid toggle changes are coalesced into a single API call.
  const notifSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -- Billing State --
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingTransactions, setBillingTransactions] = useState<BillingTransaction[]>([]);
  const [billingPagination, setBillingPagination] = useState<BillingPagination | null>(null);
  const [billingPage, setBillingPage] = useState(1);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<BillingTransaction | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptDetail, setReceiptDetail] = useState<BillingReceiptDetail | null>(null);

  useEffect(() => {
    return () => {
      if (profilePreview && profilePreview.startsWith('blob:')) {
        URL.revokeObjectURL(profilePreview);
      }
    };
  }, [profilePreview]);

  const hasPasswordInput = useMemo(() => {
    return Boolean(
      passwordForm.current.trim() ||
      passwordForm.new.trim() ||
      passwordForm.confirm.trim()
    );
  }, [passwordForm]);

  const accountDirty = useMemo(() => {
    const current = normalizeAccountForm(accountForm);
    const initial = normalizeAccountForm(initialAccountForm);
    return JSON.stringify(current) !== JSON.stringify(initial);
  }, [accountForm, initialAccountForm]);

  const notificationsDirty = useMemo(() => {
    return JSON.stringify(notifications) !== JSON.stringify(initialNotifications);
  }, [notifications, initialNotifications]);

  // Auto-save a specific notification state snapshot immediately when a toggle
  // is changed, so the preference takes effect without requiring "Save Changes".
  const autoSaveNotifications = useCallback(
    async (nextToggles: NotificationToggleState) => {
      // Debounce: cancel any in-flight timer (rapid successive toggles) and restart
      if (notifSaveTimerRef.current) clearTimeout(notifSaveTimerRef.current);

      notifSaveTimerRef.current = setTimeout(async () => {
        setSavingNotifications(true);
        try {
          const notificationPayload = buildNotificationPreferencesPayload(nextToggles);
          const response = await authFetch(`${API}/api/user/notifications/preferences`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(notificationPayload),
          });
          const data = (await response.json().catch(() => null)) as ApiEnvelope<Record<string, unknown>> | null;
          if (!response.ok || !data?.success) {
            throw new Error(extractErrorMessage(data, 'Unable to save notification preference.'));
          }
          setInitialNotifications(nextToggles);
          setNotificationsError(null);
          showToast('Notification preference updated.', 'success');
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unable to save notification preference.';
          showToast(message, 'error');
        } finally {
          setSavingNotifications(false);
        }
      }, 350); // 350 ms debounce — coalesces rapid toggles
    },
    []
  );

  const togglesDisabled =
    accountLoading || notificationsLoading || savingChanges || savingNotifications || profileUploading;

  const displayProfileImage = profilePreview || resolveMediaUrl(accountForm.profileImage);
  const avatarInitials = getInitials(`${accountForm.firstName} ${accountForm.lastName}`, accountForm.email);

  const updateAccountField = (field: keyof AccountFormState, value: string) => {
    setAccountForm((prev) => ({ ...prev, [field]: value }));
  };

  const validateAccountForm = (): string | null => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const firstName = accountForm.firstName.trim();
    const lastName = accountForm.lastName.trim();
    const email = accountForm.email.trim();
    const altEmail = accountForm.altEmail.trim();

    if (!firstName || !lastName || !email) {
      return 'First name, last name, and email are required.';
    }
    if (!emailRegex.test(email)) {
      return 'Please provide a valid primary email address.';
    }
    if (altEmail && !emailRegex.test(altEmail)) {
      return 'Please provide a valid alternative email address.';
    }
    if (altEmail && altEmail.toLowerCase() === email.toLowerCase()) {
      return 'Alternative email must be different from your primary email.';
    }
    return null;
  };

  const validatePasswordForm = (): string | null => {
    if (!hasPasswordInput) return null;

    const current = passwordForm.current;
    const next = passwordForm.new;
    const confirm = passwordForm.confirm;

    if (!current || !next || !confirm) {
      return 'Current Password, New Password, and Confirm Password are all required.';
    }
    if (next.length < 8) {
      return 'New password must be at least 8 characters long.';
    }
    if (next !== confirm) {
      return 'Confirm Password must match New Password.';
    }
    if (current === next) {
      return 'New password must be different from current password.';
    }
    return null;
  };

  const validateEmailForm = (): string | null => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const next = emailForm.new.trim();
    const confirm = emailForm.confirm.trim();
    const current = accountForm.email.trim();

    if (!next && !confirm) {
      return 'New email and confirm email are required.';
    }
    if (!next || !confirm) {
      return 'New email and confirm email are both required.';
    }
    if (!emailRegex.test(next)) {
      return 'Please provide a valid email address.';
    }
    if (next.toLowerCase() === current.toLowerCase()) {
      return 'New email must be different from your current email.';
    }
    if (next.toLowerCase() !== confirm.toLowerCase()) {
      return 'Confirm email must match the new email address.';
    }
    const altEmail = accountForm.altEmail.trim();
    if (altEmail && altEmail.toLowerCase() === next.toLowerCase()) {
      return 'Alternative email must be different from your primary email.';
    }
    return null;
  };

  const loadProfile = useCallback(async () => {
    setAccountLoading(true);
    setAccountError(null);

    try {
      const response = await authFetch(`${API}/api/user/profile`);
      const payload = (await response.json().catch(() => null)) as ApiEnvelope<UserProfilePayload> | null;

      if (!response.ok || !payload?.success || !payload.data) {
        throw new Error(extractErrorMessage(payload, 'Unable to load account settings.'));
      }
      
      const data = payload.data;
      const nextForm: AccountFormState = {
        firstName: String(data.first_name ?? '').trim(),
        lastName: String(data.last_name ?? '').trim(),
        email: String(data.email ?? '').trim(),
        altEmail: String(data.alternative_email ?? '').trim(),
        phone: String(data.phone_number ?? '').trim(),
        profileImage: resolveMediaUrl(String(data.profile_image ?? '').trim()),
      };

      setAccountForm(nextForm);
      setInitialAccountForm(nextForm);
      patchAuthUser(

        {
          first_name: nextForm.firstName,
          last_name: nextForm.lastName,
          firstName: nextForm.firstName,
          lastName: nextForm.lastName,
          email: nextForm.email,
          profile_url: nextForm.profileImage,
          profile_image: nextForm.profileImage,
          profileUrl: nextForm.profileImage,
        },
        false
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load account settings.';
      setAccountError(message);
    } finally {
      setAccountLoading(false);
    }
  }, []);

  const loadNotificationPreferences = useCallback(async () => {
    setNotificationsLoading(true);
    setNotificationsError(null);

    try {
      const response = await authFetch(`${API}/api/user/notifications/preferences`);
      const payload = (await response.json().catch(() => null)) as ApiEnvelope<NotificationPreferencesPayload> | null;

      if (!response.ok || !payload?.success) {
        throw new Error(extractErrorMessage(payload, 'Unable to load notification preferences.'));
      }

      const data = payload.data ?? {};
      const apiPrefs = (data.preferences ?? {}) as Record<string, EventPreference>;
      const emailEnabled =
        typeof data.email_notifications_enabled === 'boolean'
          ? data.email_notifications_enabled
          : data.unsubscribed_at == null;

      const nextToggles = preferencesFromApi(apiPrefs, emailEnabled);
      setNotifications(nextToggles);
      setInitialNotifications(nextToggles);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to load notification preferences.';
      setNotificationsError(message);
    } finally {
      setNotificationsLoading(false);
    }
  }, []);
  const loadBillingHistory = useCallback(async (page = 1, append = false) => {
    setBillingLoading(true);
    setBillingError(null);
    try {
      const response = await authFetch(
        `${API}/api/user/billing/transactions?page=${page}&limit=20`,
      );
      const payload = (await response.json().catch(() => null)) as ApiEnvelope<{
        transactions?: BillingTransaction[];
        pagination?: BillingPagination;
      }> | null;
      if (!response.ok || !payload?.success) {
        throw new Error(extractErrorMessage(payload, 'Unable to load billing history.'));
      }
      const rows = Array.isArray(payload.data?.transactions) ? payload.data.transactions : [];
      setBillingTransactions((prev) => (append ? [...prev, ...rows] : rows));
      setBillingPagination(payload.data?.pagination ?? null);
      setBillingPage(page);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load billing history.';
      setBillingError(message);
      if (!append) {
        setBillingTransactions([]);
        setBillingPagination(null);
      }
    } finally {
      setBillingLoading(false);
    }
  }, []);
  const loadReceiptDetail = useCallback(async (transaction: BillingTransaction) => {
    setReceiptLoading(true);
    setReceiptError(null);
    setReceiptDetail(null);
    try {
      const response = await authFetch(
        `${API}/api/user/billing/receipt/${encodeURIComponent(transaction.id)}`,
      );
      const payload = (await response.json().catch(() => null)) as ApiEnvelope<BillingReceiptDetail> | null;

      if (!response.ok || !payload?.success || !payload.data) {
        throw new Error(extractErrorMessage(payload, 'Unable to load billing details.'));
      }

      setReceiptDetail(payload.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load billing details.';
      setReceiptError(message);
    } finally {
      setReceiptLoading(false);
    }
  }, []);

  const openReceiptModal = useCallback(
    (transaction: BillingTransaction) => {
      setSelectedTransaction(transaction);
      setShowReceiptModal(true);
      void loadReceiptDetail(transaction);
    },
    [loadReceiptDetail],
  );

  const closeReceiptModal = useCallback(() => {
    setShowReceiptModal(false);
    setSelectedTransaction(null);
    setReceiptDetail(null);
    setReceiptError(null);
    setReceiptLoading(false);
  }, []);

  useEffect(() => {
    void loadProfile();
    void loadNotificationPreferences();
  }, [loadProfile, loadNotificationPreferences]);

  useEffect(() => {
    if (activeTab !== 'billing') return;
    void loadBillingHistory(1, false);
  }, [activeTab, loadBillingHistory]);

  const uploadProfileImage = useCallback(
    async (file: File) => {
      setProfileUploading(true);
      setAccountError(null);

      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('context', 'profile');

        const response = await authFetch(`${API}/api/media/upload`, {
          method: 'POST',
          body: formData,
        });

        const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

        if (!response.ok) {
          throw new Error(extractErrorMessage(payload, 'Unable to upload profile picture.'));
        }

        const uploaded = payload && typeof payload.url === 'string' ? payload.url.trim() : '';
        if (!uploaded) {
          throw new Error('Upload completed but profile URL was not returned.');
        }

        const profileUrl = resolveMediaUrl(uploaded);

        setAccountForm((prev) => ({ ...prev, profileImage: profileUrl }));
        setInitialAccountForm((prev) => ({ ...prev, profileImage: profileUrl }));
        setProfilePreview(null);

        patchAuthUser({
          email: accountForm.email.trim(),
          first_name: accountForm.firstName.trim(),
          last_name: accountForm.lastName.trim(),
          firstName: accountForm.firstName.trim(),
          lastName: accountForm.lastName.trim(),
          profile_url: profileUrl,
          profile_image: profileUrl,
          profileUrl: profileUrl,
        });

        showToast(
          response.status === 207
            ? 'Profile photo uploaded. Syncing media record in the background.'
            : 'Profile picture updated successfully.',
          'success'
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to upload profile picture.';
        throw new Error(message);
      } finally {
        setProfileUploading(false);
      }
    },
    [accountForm.email, accountForm.firstName, accountForm.lastName, showToast]
  );

  const handleProfileImageFile = (file?: File) => {
    if (!file) return;
    if (profileUploading) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      showToast('Please choose an image file (JPG, PNG, or WEBP).', 'error');
      return;
    }

    if (file.size > MAX_PROFILE_UPLOAD_BYTES) {
      showToast(
        'Profile image must be 4.5 MB or smaller for this upload route.',
        'error'
      );
      return;
    }

    setProfileCropFile(file);
  };

  const handleProfileImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    handleProfileImageFile(file);
  };

  const handleProfileDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.types.includes('Files') && !profileUploading) {
      setProfileDragActive(true);
    }
  };

  const handleProfileDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setProfileDragActive(false);
    }
  };

  const handleProfileDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setProfileDragActive(false);
    if (profileUploading) return;
    handleProfileImageFile(event.dataTransfer.files[0]);
  };

  const handleSave = async () => {
    if (savingChanges || accountLoading || profileUploading || notificationsLoading) return;

    setPasswordError(null);
    setAccountError(null);

    const accountValidationError = validateAccountForm();
    if (accountValidationError) {
      showToast(accountValidationError, 'error');
      return;
    }

    const passwordValidationError = validatePasswordForm();
    if (passwordValidationError) {
      setPasswordError(passwordValidationError);
      showToast(passwordValidationError, 'error');
      return;
    }

    if (!accountDirty && !hasPasswordInput && !notificationsDirty) {
      showToast('No changes to save.', 'info');
      return;
    }

    setSavingChanges(true);

    try {
      let profileUpdated = false;
      let passwordUpdated = false;
      let notificationsUpdated = false;

      if (accountDirty) {
        const profilePayload = {
          first_name: accountForm.firstName.trim(),
          last_name: accountForm.lastName.trim(),
          email: accountForm.email.trim().toLowerCase(),
          alternative_email: accountForm.altEmail.trim() || null,
          phone_number: accountForm.phone.trim() || null,
        };

        const profileResponse = await authFetch(`${API}/api/user/profile`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(profilePayload),
        });

        const profileData = (await profileResponse.json().catch(() => null)) as ApiEnvelope<Record<string, unknown>> | null;

        if (!profileResponse.ok || !profileData?.success) {
          throw new Error(extractErrorMessage(profileData, 'Unable to save profile changes.'));
        }

        const normalizedForm = normalizeAccountForm({
          ...accountForm,
          firstName: profilePayload.first_name,
          lastName: profilePayload.last_name,
          email: profilePayload.email,
          altEmail: profilePayload.alternative_email ?? '',
          phone: profilePayload.phone_number ?? '',
        });

        setAccountForm(normalizedForm);
        setInitialAccountForm(normalizedForm);

        patchAuthUser(
          {
            first_name: normalizedForm.firstName,
            last_name: normalizedForm.lastName,
            firstName: normalizedForm.firstName,
            lastName: normalizedForm.lastName,
            email: normalizedForm.email,
            profile_url: normalizedForm.profileImage,
            profile_image: normalizedForm.profileImage,
            profileUrl: normalizedForm.profileImage,
          },
          false
        );

        profileUpdated = true;
      }

      if (hasPasswordInput) {
        const passwordResponse = await authFetch(`${API}/api/user/password/change`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            current_password: passwordForm.current,
            new_password: passwordForm.new,
            confirm_password: passwordForm.confirm,
          }),
        });

        const passwordData = (await passwordResponse.json().catch(() => null)) as ApiEnvelope<Record<string, unknown>> | null;

        if (!passwordResponse.ok || !passwordData?.success) {
          throw new Error(extractErrorMessage(passwordData, 'Unable to change password.'));
        }

        setPasswordForm({ current: '', new: '', confirm: '' });
        setPasswordError(null);
        passwordUpdated = true;
      }

      if (notificationsDirty) {
        const notificationPayload = buildNotificationPreferencesPayload(notifications);
        const notificationResponse = await authFetch(`${API}/api/user/notifications/preferences`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(notificationPayload),
        });

        const notificationData = (await notificationResponse.json().catch(() => null)) as ApiEnvelope<Record<string, unknown>> | null;

        if (!notificationResponse.ok || !notificationData?.success) {
          throw new Error(extractErrorMessage(notificationData, 'Unable to save notification preferences.'));
        }

        setInitialNotifications(notifications);
        setNotificationsError(null);
        notificationsUpdated = true;
      }

      dispatchUserSync();

      const successParts: string[] = [];
      if (profileUpdated) successParts.push('profile');
      if (passwordUpdated) successParts.push('password');
      if (notificationsUpdated) successParts.push('notification preferences');

      showToast(
        successParts.length === 0
          ? 'Settings saved successfully.'
          : `${successParts.join(', ').replace(/,([^,]*)$/, ' and$1')} updated successfully.`,
        'success'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save settings.';
      showToast(message, 'error');
    } finally {
      setSavingChanges(false);
    }
  };

  const handleSaveEmail = async () => {
    if (savingEmail || accountLoading) return;

    setEmailError(null);

    const emailValidationError = validateEmailForm();
    if (emailValidationError) {
      setEmailError(emailValidationError);
      showToast(emailValidationError, 'error');
      return;
    }

    setSavingEmail(true);

    try {
      const newEmail = emailForm.new.trim().toLowerCase();
      // Email-only partial update — omit names so server skips first_name/last_name validation.
      const profilePayload = { email: newEmail };

      const profileResponse = await authFetch(`${API}/api/user/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profilePayload),
      });

      const profileData = (await profileResponse.json().catch(() => null)) as ApiEnvelope<{
        verification_needed?: string[];
      }> | null;

      if (!profileResponse.ok || !profileData?.success) {
        if (profileResponse.status === 409) {
          throw new Error('Email is already in use.');
        }
        throw new Error(extractErrorMessage(profileData, 'Unable to update email address.'));
      }

      const normalizedForm = normalizeAccountForm({
        ...accountForm,
        email: newEmail,
      });

      setAccountForm(normalizedForm);
      setInitialAccountForm(normalizedForm);
      setEmailForm({ new: '', confirm: '' });
      setEmailError(null);

      patchAuthUser({ email: newEmail }, false);
      dispatchUserSync();

      const verificationNeeded = profileData.data?.verification_needed?.includes('email');
      showToast(
        verificationNeeded
          ? 'Email updated successfully. A verification code was sent to your new address.'
          : 'Email updated successfully.',
        'success'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update email address.';
      setEmailError(message);
      showToast(message, 'error');
    } finally {
      setSavingEmail(false);
    }
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-lg h-full px-1 py-1 sm:max-w-none sm:p-2 md:p-6 lg:p-8 overflow-y-auto overflow-x-hidden bg-white/50 space-y-5 sm:space-y-8 pb-24 sm:pb-32 scrollbar-thin">
      <ProfileImageCropModal
        file={profileCropFile}
        onClose={() => setProfileCropFile(null)}
        onApply={async (croppedFile) => {
          const previewUrl = URL.createObjectURL(croppedFile);
          setProfilePreview(previewUrl);
          try {
            await uploadProfileImage(croppedFile);
          } catch (error) {
            setProfilePreview(null);
            throw error;
          }
        }}
      />
      {/* Header */}
      <div className="min-w-0">
        <h1 className="text-lg sm:text-2xl font-bold text-gray-900 break-words">Settings page</h1>
        <p className="mt-1 text-sm text-gray-500">Edit your personal information</p>
      </div>
      {/* Tabs */}
      <div className="flex gap-1 sm:gap-4 border-b border-gray-200 overflow-x-auto scrollbar-thin">
        <button
          onClick={() => setActiveTab('account')}
          className={`shrink-0 min-h-11 pb-3 px-2 sm:px-4 text-sm font-medium transition-colors relative ${
            activeTab === 'account' ? 'text-[#2D3A8C]' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Account
          {activeTab === 'account' && (
            <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#2D3A8C]" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('billing')}
          className={`shrink-0 min-h-11 pb-3 px-2 sm:px-4 text-sm font-medium transition-colors relative ${
            activeTab === 'billing' ? 'text-[#2D3A8C]' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Billing History
          {activeTab === 'billing' && (
            <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#2D3A8C]" />
          )}
        </button>
      </div>
      {/* Account Content */}
      {activeTab === 'account' && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }} 
          animate={{ opacity: 1, y: 0 }}
          className="space-y-5 sm:space-y-6 min-w-0"
        >
          {accountError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 sm:px-4 text-sm text-red-700">
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <span className="break-words">{accountError}</span>
                <button
                  onClick={() => void loadProfile()}
                  className="rounded-md border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {accountLoading ? (
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3 text-gray-600">
                <InlineLoader />
                <span className="text-sm font-medium">Loading account settings...</span>
              </div>
            </div>
          ) : (
            <>
              <div className="mx-auto grid w-full min-w-0 max-w-lg grid-cols-1 justify-items-stretch gap-5 sm:gap-6 sm:max-w-none xl:grid-cols-2">
                {/* Personal Info */}
                <div className="w-full min-w-0 bg-white p-4 sm:p-6 rounded-xl border border-gray-200 shadow-sm space-y-5 sm:space-y-6">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-800 flex items-center gap-2">
                    <User className="w-5 h-5 shrink-0 text-[#2D3A8C]" /> Personal Information
                  </h3>

                  <div
                    onDragOver={handleProfileDragOver}
                    onDragLeave={handleProfileDragLeave}
                    onDrop={handleProfileDrop}
                    className={`rounded-xl border border-gray-200 bg-gray-50 p-3 sm:p-4 transition-shadow ${
                      profileDragActive ? 'ring-2 ring-[#2D3A8C]/40' : ''
                    }`}
                  >
                    <div className="flex flex-col items-center gap-3 text-center min-w-0 lg:flex-row lg:items-center lg:gap-4 lg:text-left">
                      <button
                        type="button"
                        title="Click to change your profile picture"
                        onClick={() => profileInputRef.current?.click()}
                        disabled={profileUploading}
                        className="relative h-20 w-20 shrink-0 disabled:opacity-60"
                      >
                        <span className="block h-full w-full overflow-hidden rounded-full border-2 border-white bg-[#2D3A8C]/15 shadow-sm ring-1 ring-gray-200">
                          {displayProfileImage ? (
                            <img src={displayProfileImage} alt="Profile" className="h-full w-full object-cover" />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center text-xl font-bold text-[#2D3A8C]">
                              {avatarInitials}
                            </span>
                          )}
                        </span>
                        <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-[#2D3A8C] p-1 text-white shadow z-50">
                          {profileUploading ? (
                            <InlineLoader />
                          ) : (
                            <Camera className="h-3 w-3" />
                          )}
                        </span>
                      </button>

                      <div className="min-w-0 w-full lg:w-auto">
                        <p className="text-sm font-semibold text-gray-800">Profile Picture</p>
                        <p className="mt-1 text-xs leading-relaxed text-gray-500 break-words">
                          Choose a photo to crop and position before it is uploaded. JPG, PNG, and WEBP are supported (up to 4.5 MB).
                        </p>
                        <button
                          type="button"
                          onClick={() => profileInputRef.current?.click()}
                          disabled={profileUploading}
                          className="mt-2 inline-flex min-h-10 items-center text-xs font-semibold text-[#2D3A8C] hover:text-[#1c2763] disabled:opacity-60 cursor-pointer"
                        >
                          {profileUploading ? 'Uploading image...' : 'Choose new photo'}
                        </button>
                      </div>
                    </div>
                    <input
                      ref={profileInputRef}
                      type="file"
                      accept="image/jpeg,image/jpg,image/png,image/webp"
                      className="hidden"
                      onChange={handleProfileImageChange}
                    />
                  </div>

                  <div className="space-y-4">
                    <InputField
                      label="First Name"
                      value={accountForm.firstName}
                      onChange={(e) => updateAccountField('firstName', e.target.value)}
                    />
                    <InputField
                      label="Last Name"
                      value={accountForm.lastName}
                      onChange={(e) => updateAccountField('lastName', e.target.value)}
                    />
                    <InputField
                      label="Alternative Email"
                      type="email"
                      value={accountForm.altEmail}
                      onChange={(e) => updateAccountField('altEmail', e.target.value)}
                    />
                    <InputField
                      label="Phone Number"
                      type="tel"
                      value={accountForm.phone}
                      onChange={(e) => updateAccountField('phone', e.target.value)}
                    />
                  </div>
                </div>

                {/* Change Password */}
                <div className="w-full min-w-0 bg-white p-4 sm:p-6 rounded-xl border border-gray-200 shadow-sm space-y-5 sm:space-y-6">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-800 flex items-center gap-2">
                    <Lock className="w-5 h-5 shrink-0 text-[#2D3A8C]" /> Change Password
                  </h3>

                  <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700">
                    Password must be at least 8 characters and must not match your current password.
                  </div>
                  <div className="space-y-4">
                    <InputField
                      label="Current Password"
                      type="password"
                      icon={Lock}
                      value={passwordForm.current}
                      onChange={(e) => setPasswordForm((prev) => ({ ...prev, current: e.target.value }))}
                    />
                    <InputField
                      label="New Password"
                      type="password"
                      icon={Lock}
                      value={passwordForm.new}
                      onChange={(e) => setPasswordForm((prev) => ({ ...prev, new: e.target.value }))}
                    />
                    <InputField
                      label="Confirm Password"
                      type="password"
                      icon={Lock}
                      value={passwordForm.confirm}
                      onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirm: e.target.value }))}
                    />
                  </div>

                  {passwordError && (
                    <p className="text-sm text-red-600">{passwordError}</p>
                  )}
                </div>

                {/* Change Email Address */}
                <div className="w-full min-w-0 bg-white p-4 sm:p-6 rounded-xl border border-gray-200 shadow-sm space-y-5 sm:space-y-6">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-800 flex items-center gap-2">
                    <Mail className="w-5 h-5 shrink-0 text-[#2D3A8C]" /> Change Email Address
                  </h3>

                  <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700">
                    Your email address is also your login credential. After saving, use the new email to sign in. A verification code may be sent to your new address.
                  </div>

                  <p className="text-sm text-gray-600">
                    Current email:{' '}
                    <span className="font-medium text-gray-800 break-all">{accountForm.email || '—'}</span>
                  </p>

                  <div className="space-y-4">
                    <InputField
                      label="New Email Address"
                      type="email"
                      icon={Mail}
                      value={emailForm.new}
                      onChange={(e) => setEmailForm((prev) => ({ ...prev, new: e.target.value }))}
                    />
                    <InputField
                      label="Confirm Email Address"
                      type="email"
                      icon={Mail}
                      value={emailForm.confirm}
                      onChange={(e) => setEmailForm((prev) => ({ ...prev, confirm: e.target.value }))}
                    />
                  </div>

                  {emailError && (
                    <p className="text-sm text-red-600">{emailError}</p>
                  )}

                  <div className="flex justify-stretch sm:justify-end">
                    <GradientButton
                      className="w-full sm:w-auto"
                      onClick={() => void handleSaveEmail()}
                      disabled={savingEmail || accountLoading}
                    >
                      {savingEmail ? (
                        <span className="flex items-center gap-2">
                          <InlineLoader /> Saving...
                        </span>
                      ) : 'Save Email'}
                    </GradientButton>
                  </div>
                </div>

                <SecuritySessionsPanel />

                <PasskeyManagementPanel />
              </div>

              {/* Notifications */}
              <div className="mx-auto w-full min-w-0 max-w-lg bg-white p-4 sm:p-6 rounded-xl border border-gray-200 shadow-sm space-y-5 sm:space-y-6 sm:max-w-none">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-800 flex items-center gap-2">
                    <Bell className="w-5 h-5 shrink-0 text-[#2D3A8C]" /> Notifications
                  </h3>
                  {notificationsLoading ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                      <InlineLoader />
                      Loading…
                    </span>
                  ) : savingNotifications ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-[#2D3A8C]">
                      <InlineLoader />
                      Saving…
                    </span>
                  ) : null}
                </div>
                {notificationsError && (
                  <p className="text-sm text-red-600">{notificationsError}</p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   <ToggleSwitch
                     label="Email notifications"
                     subLabel="Receive notification emails for enabled alert types"
                     enabled={notifications.email}
                     disabled={togglesDisabled}
                     onChange={(v: boolean) => {
                       const next = { ...notifications, email: v };
                       setNotifications(next);
                       void autoSaveNotifications(next);
                     }}
                   />
                   <ToggleSwitch
                     label="Inquiry Alerts"
                     subLabel="Get notified when someone sends you an inquiry"
                     enabled={notifications.inquiry}
                     disabled={togglesDisabled}
                     onChange={(v: boolean) => {
                       const next = { ...notifications, inquiry: v };
                       setNotifications(next);
                       void autoSaveNotifications(next);
                     }}
                   />
                   <ToggleSwitch
                     label="QR Scans Alerts"
                     subLabel="Get notified when your BizCard or portfolio is viewed"
                     enabled={notifications.qr}
                     disabled={togglesDisabled}
                     onChange={(v: boolean) => {
                       const next = { ...notifications, qr: v };
                       setNotifications(next);
                       void autoSaveNotifications(next);
                     }}
                   />
                   <ToggleSwitch
                     label="Promotional Emails"
                     subLabel="Receive offers, announcements, and marketing updates"
                     enabled={notifications.promo}
                     disabled={togglesDisabled}
                     onChange={(v: boolean) => {
                       const next = { ...notifications, promo: v };
                       setNotifications(next);
                       void autoSaveNotifications(next);
                     }}
                   />
                   <ToggleSwitch
                     label="System Updates"
                     subLabel="Get notified about platform changes and maintenance"
                     enabled={notifications.updates}
                     disabled={togglesDisabled}
                     onChange={(v: boolean) => {
                       const next = { ...notifications, updates: v };
                       setNotifications(next);
                       void autoSaveNotifications(next);
                     }}
                   />
                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 min-w-0">
                <p className="text-xs text-gray-500 leading-relaxed">
                  Profile picture uploads and notification toggles are applied immediately. Use Save Changes for profile fields and password updates. Use Save Email in the Change Email Address section to update your login email.
                </p>
                <GradientButton className="w-full shrink-0 sm:w-auto" onClick={handleSave} disabled={savingChanges || profileUploading || accountLoading || notificationsLoading}>
                  {savingChanges ? (
                    <span className="flex items-center gap-2">
                      <InlineLoader /> Saving...
                    </span>
                  ) : 'Save Changes'}
                </GradientButton>
              </div>
            </>
          )}
        </motion.div>
      )}

      {/* Billing Content */}
      {activeTab === 'billing' && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }} 
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6 sm:space-y-8 min-w-0"
        >
          <div className="space-y-4 min-w-0">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <h3 className="text-base sm:text-lg font-bold text-gray-800">Billing History</h3>
              {billingPagination && billingPagination.total > 0 && (
                <span className="text-xs text-gray-500">
                  {billingPagination.total} transaction{billingPagination.total === 1 ? '' : 's'}
                </span>
              )}
            </div>

            {billingError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 sm:px-4 text-sm text-red-700">
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <span className="break-words">{billingError}</span>
                  <button
                    onClick={() => void loadBillingHistory(1, false)}
                    className="rounded-md border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}

            {billingLoading && billingTransactions.length === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
                <div className="flex items-center justify-center gap-3 text-gray-600">
                  <InlineLoader />
                  <span className="text-sm">Loading billing history...</span>
                </div>
              </div>
            ) : billingTransactions.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 h-64 flex flex-col items-center justify-center text-gray-400 gap-3">
                <History className="w-10 h-10 opacity-20" />
                <p className="text-sm">No payment history</p>
                <p className="text-xs text-gray-300 text-center px-6">
                  Purchases, subscriptions, plan changes, and cancellations will appear here.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
                <ul className="divide-y divide-gray-100">
                  {billingTransactions.map((transaction) => (
                    <li key={transaction.id}>
                      <button
                        type="button"
                        onClick={() => openReceiptModal(transaction)}
                        className="flex w-full min-w-0 items-start gap-3 px-3 py-3.5 text-left transition-colors hover:bg-gray-50 sm:items-center sm:gap-4 sm:px-6 sm:py-4"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#2D3A8C]/10">
                          <Receipt className="h-5 w-5 text-[#2D3A8C]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="break-words text-sm font-semibold text-gray-900">
                              {transaction.description}
                            </p>
                            <span className="rounded-full border border-[#2D3A8C]/20 bg-[#2D3A8C]/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#2D3A8C]">
                              {billingTypeLabel(transaction.type)}
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${billingStatusClasses(transaction.status)}`}
                            >
                              {transaction.status}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-gray-500 break-words">
                            {formatBillingDate(transaction.date)}
                            {transaction.metadata?.order_number
                              ? ` · Order ${transaction.metadata.order_number}`
                              : transaction.metadata?.bizcard_serial
                                ? ` · BizCard #${transaction.metadata.bizcard_serial}`
                                : ''}
                          </p>
                          <p className="mt-1.5 text-sm font-semibold text-gray-900 sm:hidden">
                            {transaction.formatted_amount}
                          </p>
                        </div>
                        <div className="hidden shrink-0 items-center gap-3 sm:flex">
                          <span className="text-sm font-semibold text-gray-900">
                            {transaction.formatted_amount}
                          </span>
                          <ChevronRight className="h-4 w-4 text-gray-400" />
                        </div>
                        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-gray-400 sm:hidden" />
                      </button>
                    </li>
                  ))}
                </ul>
                {billingPagination && billingPagination.page < billingPagination.pages && (
                  <div className="border-t border-gray-100 p-4">
                    <button
                      type="button"
                      onClick={() => void loadBillingHistory(billingPage + 1, true)}
                      disabled={billingLoading}
                      className="w-full rounded-lg border border-gray-200 bg-white py-2.5 text-sm font-semibold text-[#2D3A8C] transition-colors hover:bg-gray-50 disabled:opacity-50"
                    >
                      {billingLoading ? (
                        <span className="inline-flex items-center gap-2">
                          <InlineLoader />
                          Loading...
                        </span>
                      ) : (
                        'Load more'
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {showReceiptModal && (
        <ModalPortal isOpen={showReceiptModal} onClose={closeReceiptModal}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto overflow-x-hidden rounded-2xl border border-gray-100 bg-white p-4 sm:p-6 shadow-2xl mx-3 sm:mx-0 min-w-0"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#2D3A8C]/10">
                  <Receipt className="h-5 w-5 text-[#2D3A8C]" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Billing Details</h3>
                  <p className="text-xs text-gray-500">
                    {selectedTransaction ? formatBillingDate(selectedTransaction.date) : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeReceiptModal}
                className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close billing details"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {receiptLoading ? (
              <div className="flex items-center justify-center gap-3 py-12 text-gray-600">
                <InlineLoader className="text-[#2D3A8C]" />
                <span className="text-sm">Loading details...</span>
              </div>
            ) : receiptError ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {receiptError}
                </div>
                {selectedTransaction && (
                  <button
                    type="button"
                    onClick={() => void loadReceiptDetail(selectedTransaction)}
                    className="w-full rounded-lg border border-gray-200 bg-white py-2.5 text-sm font-semibold text-[#2D3A8C] hover:bg-gray-50"
                  >
                    Retry
                  </button>
                )}
              </div>
            ) : receiptDetail ? (
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-gray-500">Transaction ID</p>
                    <p className="font-medium text-gray-900 break-all">{receiptDetail.transaction_id}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Invoice</p>
                    <p className="font-medium text-gray-900">{receiptDetail.invoice_number}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Status</p>
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${billingStatusClasses(receiptDetail.status)}`}
                    >
                      {receiptDetail.status}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Payment</p>
                    <p className="font-medium text-gray-900 capitalize">
                      {receiptDetail.payment_method?.type ?? 'xendit'}
                    </p>
                  </div>
                </div>

                {receiptDetail.subscription && (
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Subscription
                    </p>
                    <div className="space-y-1 text-gray-700">
                      {receiptDetail.subscription.bizcard_serial && (
                        <p>BizCard #{receiptDetail.subscription.bizcard_serial}</p>
                      )}
                      {receiptDetail.subscription.from_plan && (
                        <p>From: {receiptDetail.subscription.from_plan.name}</p>
                      )}
                      <p>To: {receiptDetail.subscription.to_plan.name}</p>
                      {receiptDetail.subscription.billing_cycle && (
                        <p className="capitalize">Billing: {receiptDetail.subscription.billing_cycle}</p>
                      )}
                      <p>Effective: {formatBillingDate(receiptDetail.subscription.effective_date)}</p>
                      {receiptDetail.subscription.expiry_date && (
                        <p>Expires: {formatBillingDate(receiptDetail.subscription.expiry_date)}</p>
                      )}
                      {receiptDetail.event_type && (
                        <p className="text-xs text-gray-500 capitalize">
                          Event: {receiptDetail.event_type.replace(/_/g, ' ')}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {receiptDetail.customer && (
                  <div className="text-sm">
                    <p className="text-xs text-gray-500">Customer</p>
                    <p className="font-medium text-gray-900">{receiptDetail.customer.name}</p>
                    <p className="text-gray-600">{receiptDetail.customer.email}</p>
                  </div>
                )}

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Items</p>
                  <div className="overflow-x-auto rounded-lg border border-gray-100">
                    <table className="w-full min-w-[280px] text-sm">
                      <thead className="bg-gray-50 text-left text-xs text-gray-500">
                        <tr>
                          <th className="px-3 py-2 font-medium">Description</th>
                          <th className="px-3 py-2 font-medium text-right">Qty</th>
                          <th className="px-3 py-2 font-medium text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {receiptDetail.items.map((item, index) => (
                          <tr key={`${item.description}-${index}`}>
                            <td className="px-3 py-2 text-gray-800">{item.description}</td>
                            <td className="px-3 py-2 text-right text-gray-600">{item.quantity}</td>
                            <td className="px-3 py-2 text-right font-medium text-gray-900">
                              {new Intl.NumberFormat(undefined, {
                                style: 'currency',
                                currency: receiptDetail.currency,
                              }).format(item.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="space-y-1 border-t border-gray-100 pt-4 text-sm">
                  <div className="flex justify-between text-gray-600">
                    <span>Subtotal</span>
                    <span>
                      {new Intl.NumberFormat(undefined, {
                        style: 'currency',
                        currency: receiptDetail.currency,
                      }).format(receiptDetail.subtotal)}
                    </span>
                  </div>
                  {typeof receiptDetail.discount === 'number' && receiptDetail.discount > 0 && (
                    <div className="flex justify-between text-gray-600">
                      <span>Discount</span>
                      <span>
                        -{new Intl.NumberFormat(undefined, {
                          style: 'currency',
                          currency: receiptDetail.currency,
                        }).format(receiptDetail.discount)}
                      </span>
                    </div>
                  )}
                  {typeof receiptDetail.shipping === 'number' && receiptDetail.shipping > 0 && (
                    <div className="flex justify-between text-gray-600">
                      <span>Shipping</span>
                      <span>
                        {new Intl.NumberFormat(undefined, {
                          style: 'currency',
                          currency: receiptDetail.currency,
                        }).format(receiptDetail.shipping)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-gray-600">
                    <span>Tax</span>
                    <span>
                      {new Intl.NumberFormat(undefined, {
                        style: 'currency',
                        currency: receiptDetail.currency,
                      }).format(receiptDetail.tax)}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 text-base font-bold text-gray-900">
                    <span>Total</span>
                    <span>{receiptDetail.formatted_total}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={closeReceiptModal}
                  className="w-full rounded-lg border border-gray-200 bg-white py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            ) : null}
          </motion.div>
        </ModalPortal>
      )}

    </div>
  );
};

export default Settings;
