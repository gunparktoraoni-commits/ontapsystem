/**
 * Shared client logout helpers.
 * Ensures every portal clears the same auth cookies (client-visible),
 * localStorage/sessionStorage caches, and then hard-navigates away.
 */

import { csrfClient } from "@/lib/csrf-client";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { clearAllBizcardCaches } from "@/app/lib/bizcardCache";
import { hardResetAllPortfolioBrowserCaches } from "@/app/lib/portfolioBrowserCache";
import {
  clearImpersonationHandoff,
  IMPERSONATION_HANDOFF_COOKIE,
} from "@/app/lib/superadminImpersonationHandoff";

/** Exact localStorage keys that hold auth/session/cache state. */
const LOCAL_STORAGE_KEYS = [
  "authUser",
  "auth_token",
  "superadmin_token",
  "superadmin_profile",
  "superadmin_savedCredentials",
  "savedCredentials",
  "savedLoginEmail",
  "lastPasskeyUser",
  "latestPortfolioAlias",
  "ontap:setup:session",
  "ontap:last-accessed-bizcards",
  "ontap_session_id",
  "ontap:session_id",
  // Same key as sessionStorage — persistClaimSerial writes both; must clear both on logout
  "assignedBizcardSerial",
] as const;

/** Exact sessionStorage keys that hold auth/redirect/session state. */
const SESSION_STORAGE_KEYS = [
  "auth_token",
  "superadmin_token",
  "post_login_redirect",
  "post_signup_redirect",
  "post_password_change_redirect",
  "assignedBizcardSerial",
  "superadmin_impersonation_handoff_token",
  "superadmin_impersonation_company_id",
  "superadmin_impersonation_user_id",
] as const;

/** Prefixes for cached gallery / profile blobs (portfolio_* cleared via hardReset). */
const LOCAL_STORAGE_PREFIXES = [
  "gallery_",
  "bizcard_profile",
  "ontap:setup:",
] as const;

/** Client-visible cookies that can (and should) be expired from JS. */
const CLIENT_COOKIE_NAMES = [
  "csrf-token",
  IMPERSONATION_HANDOFF_COOKIE,
] as const;

function expireClientCookie(name: string): void {
  if (typeof document === "undefined") return;

  const expires = "Thu, 01 Jan 1970 00:00:00 GMT";
  // Browsers only delete cookies when attributes match how they were set.
  // Emit common combinations used across Chrome / Safari / Firefox / CHIPS.
  const variants = [
    `${name}=; path=/; expires=${expires}; max-age=0; SameSite=Lax`,
    `${name}=; path=/; expires=${expires}; max-age=0; SameSite=Lax; Secure`,
    `${name}=; path=/; expires=${expires}; max-age=0; SameSite=None; Secure`,
    `${name}=; path=/; expires=${expires}; max-age=0; SameSite=None; Secure; Partitioned`,
  ];

  for (const cookie of variants) {
    try {
      document.cookie = cookie;
    } catch {
      // Ignore cookie write failures (privacy mode / blocked cookies).
    }
  }
}

function removeStorageKeys(
  storage: Storage,
  exactKeys: readonly string[],
  prefixes: readonly string[] = [],
): void {
  try {
    for (const key of exactKeys) {
      storage.removeItem(key);
    }

    if (!prefixes.length) return;

    const toRemove: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key) continue;
      if (prefixes.some((prefix) => key.startsWith(prefix))) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      storage.removeItem(key);
    }
  } catch {
    // Safari private mode / disabled storage can throw.
  }
}

/**
 * Absolute client-side cleanup of auth caches and session remnants.
 * Safe to call even when the server logout request fails.
 */
export function clearClientAuthCache(): void {
  if (typeof window === "undefined") return;

  try {
    clearImpersonationHandoff();
  } catch {
    // ignore
  }

  try {
    clearAllBizcardCaches();
  } catch {
    // ignore
  }

  try {
    hardResetAllPortfolioBrowserCaches();
  } catch {
    // ignore
  }

  removeStorageKeys(window.localStorage, LOCAL_STORAGE_KEYS, LOCAL_STORAGE_PREFIXES);
  removeStorageKeys(window.sessionStorage, SESSION_STORAGE_KEYS, [
    "superadmin_impersonation_",
  ]);

  // Returning users land on "/" after logout. Mark the tutorial seen so
  // OnboardingGate shows LoginUser instead of OnboardingTutorial.
  try {
    window.localStorage.setItem("ontap:tutorial:seen", "true");
  } catch {
    // Safari private mode / disabled storage can throw.
  }

  for (const name of CLIENT_COOKIE_NAMES) {
    expireClientCookie(name);
  }

  try {
    csrfClient.clearCsrfCookie();
  } catch {
    // ignore
  }
}

export type PerformLogoutOptions = {
  apiBaseUrl?: string;
  /** Hard-navigate after cleanup. Pass null to skip redirect. */
  redirectTo?: string | null;
  /** Prefer admin logout endpoint (extra audit) when known company/admin session. */
  useAdminEndpoint?: boolean;
};

/**
 * Call server logout, wipe client auth state, then hard-navigate.
 * Hard navigation avoids stale React/router state retaining session UI.
 */
export async function performLogout(
  options: PerformLogoutOptions = {},
): Promise<{ ok: boolean }> {
  const apiBase = (
    options.apiBaseUrl ??
    getFrontendApiBaseUrl() ??
    (typeof window !== "undefined" ? window.location.origin : "")
  ).replace(/\/+$/, "");

  const endpoint = options.useAdminEndpoint
    ? `${apiBase}/api/auth/admin/logout`
    : `${apiBase}/api/auth/logout`;

  let ok = false;

  try {
    const csrfToken = await csrfClient.getToken(false, apiBase || undefined);
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      },
      body: "{}",
    });
    ok = response.ok;
  } catch {
    ok = false;
  }

  clearClientAuthCache();

  const redirectTo =
    options.redirectTo === undefined ? "/" : options.redirectTo;

  if (redirectTo && typeof window !== "undefined") {
    // Hard navigation clears in-memory app state across browsers more reliably
    // than client router.replace alone.
    window.location.assign(redirectTo);
  }

  return { ok };
}
