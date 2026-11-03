/**
 * Hard-reset helpers for browser-stored portfolio snapshots.
 * Live portfolio pages must never treat localStorage as a source of truth.
 */

export const PORTFOLIO_REFRESH_STORAGE_KEY = "portfolio_refresh_ts";
export const PORTFOLIO_STORAGE_PREFIX = "portfolio_";

function safeRemove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Safari private mode / disabled storage can throw.
  }
}

function collectPrefixedKeys(storage: Storage, prefix: string): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key) continue;
      if (key === PORTFOLIO_REFRESH_STORAGE_KEY) continue;
      if (key.startsWith(prefix)) keys.push(key);
    }
  } catch {
    // ignore enumeration failures
  }
  return keys;
}

/** Remove the display snapshot for one alias (and common casing variants). */
export function hardResetPortfolioAliasCache(alias: string): void {
  if (typeof window === "undefined") return;
  const trimmed = alias.trim();
  if (!trimmed) return;

  const variants = Array.from(
    new Set([trimmed, trimmed.toLowerCase(), encodeURIComponent(trimmed)]),
  );

  for (const value of variants) {
    safeRemove(window.localStorage, `${PORTFOLIO_STORAGE_PREFIX}${value}`);
  }
}

/**
 * Wipe all `portfolio_*` blobs and the refresh timestamp from the device browser.
 * Call on public portfolio mount so stale device data cannot paint the page.
 */
export function hardResetAllPortfolioBrowserCaches(): void {
  if (typeof window === "undefined") return;

  for (const key of collectPrefixedKeys(
    window.localStorage,
    PORTFOLIO_STORAGE_PREFIX,
  )) {
    safeRemove(window.localStorage, key);
  }
  safeRemove(window.localStorage, PORTFOLIO_REFRESH_STORAGE_KEY);

  // Legacy / mistyped keys in sessionStorage.
  for (const key of collectPrefixedKeys(
    window.sessionStorage,
    PORTFOLIO_STORAGE_PREFIX,
  )) {
    safeRemove(window.sessionStorage, key);
  }
  safeRemove(window.sessionStorage, PORTFOLIO_REFRESH_STORAGE_KEY);
}

/**
 * Signal other tabs to refetch from the API without writing portfolio content
 * into localStorage.
 */
export function markPortfolioNeedsServerRefresh(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PORTFOLIO_REFRESH_STORAGE_KEY,
      String(Date.now()),
    );
  } catch {
    // ignore
  }
  try {
    window.dispatchEvent(new Event("ontap:user-sync"));
  } catch {
    // ignore
  }
}
