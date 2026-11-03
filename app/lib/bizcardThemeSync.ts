import { markPortfolioNeedsServerRefresh } from "./portfolioBrowserCache";
import {
  getLastAccessedBizcards,
  recordLastAccessedBizcard,
  resolveBizcardDisplayName,
} from "./lastAccessedBizcard";
import { normalizePortfolioThemeId } from "../themes/ThemeLoader";
import { getFrontendApiBaseUrl } from "../components/apiBase";
import { withImpersonationHeaders } from "./superadminImpersonationHandoff";

export const USER_SYNC_EVENT = "ontap:user-sync";
export const PORTFOLIO_REFRESH_STORAGE_KEY = "portfolio_refresh_ts";
export const RECENT_THEME_OVERRIDE_MS = 180_000;
export const PORTFOLIO_BROADCAST_CHANNEL = "ontap-portfolio-sync";
const CSRF_COOKIE_NAME = "csrf-token";

export type SidebarThemeResolve = {
  family: string;
  cardTheme?: string;
};

const SIDEBAR_THEME_RESOLVE: Record<string, SidebarThemeResolve> = {
  "elegant-dark": { family: "elegant-dark", cardTheme: "original" },
  "elegant-dark-v2": { family: "elegant-dark", cardTheme: "v2" },
  "elegant-dark-v3": { family: "elegant-dark", cardTheme: "v3" },
  "modern-minimalist": { family: "modern-minimalist", cardTheme: "charcoal-yellow" },
  "charcoal-yellow": { family: "modern-minimalist", cardTheme: "charcoal-yellow" },
  "light-blue": { family: "modern-minimalist", cardTheme: "light-blue" },
  "ocean-blue": { family: "modern-minimalist", cardTheme: "ocean-blue" },
  "simple-classico": { family: "simple-classico", cardTheme: "green-gold" },
  "green-gold": { family: "simple-classico", cardTheme: "green-gold" },
  "blue-red": { family: "simple-classico", cardTheme: "blue-red" },
  "hot-orange": { family: "simple-classico", cardTheme: "hot-orange" },
  "bubble-glass": { family: "floral-madness", cardTheme: "rose-bloom" },
  "floral-madness": { family: "floral-madness", cardTheme: "rose-bloom" },
  "rose-bloom": { family: "floral-madness", cardTheme: "rose-bloom" },
  "hibiscus-dusk": { family: "floral-madness", cardTheme: "hibiscus-dusk" },
  "jasmine-mist": { family: "floral-madness", cardTheme: "jasmine-mist" },
  "candy-flush": { family: "floral-madness", cardTheme: "rose-bloom" },
  "snow-contrast": { family: "floral-madness", cardTheme: "jasmine-mist" },
  "fiery-sunset": { family: "floral-madness", cardTheme: "hibiscus-dusk" },
  "ocean-gradient": { family: "ocean-gradient", cardTheme: "teal" },
  "ocean-gradient-v2": { family: "ocean-gradient", cardTheme: "green" },
  "ocean-gradient-v3": { family: "ocean-gradient", cardTheme: "orange" },
  "premium-gotham": { family: "premium-gotham", cardTheme: "carbon-diamond" },
  "carbon-diamond": { family: "premium-gotham", cardTheme: "carbon-diamond" },
  "void-purple": { family: "premium-gotham", cardTheme: "void-purple" },
  "timeless-gold": { family: "premium-gotham", cardTheme: "timeless-gold" },
  "royal-purple": { family: "royal-purple", cardTheme: "purple" },
  "royal-purple-v2": { family: "royal-purple", cardTheme: "teal" },
  "royal-purple-v3": { family: "royal-purple", cardTheme: "amber" },
  "luxurious-editorial": { family: "luxurious-editorial", cardTheme: "classic-gold" },
  "classic-gold": { family: "luxurious-editorial", cardTheme: "classic-gold" },
  "ocean-blue-gold": { family: "luxurious-editorial", cardTheme: "ocean-blue-gold" },
  "blue-gold": { family: "luxurious-editorial", cardTheme: "ocean-blue-gold" },
  "violet-pink": { family: "luxurious-editorial", cardTheme: "violet-pink" },
  "grainy-white": { family: "luxurious-editorial", cardTheme: "violet-pink" },
  "nouveau-riche": { family: "nouveau-riche", cardTheme: "blood-rose" },
  "pristine-gold": { family: "nouveau-riche", cardTheme: "pristine-gold" },
  "blood-rose": { family: "nouveau-riche", cardTheme: "blood-rose" },
  "minty-green": { family: "nouveau-riche", cardTheme: "minty-green" },
  "og-neumorphic": { family: "og-neumorphic", cardTheme: "ice" },
  "ice-variant": { family: "og-neumorphic", cardTheme: "ice" },
  "warm-pastel": { family: "og-neumorphic", cardTheme: "pastel" },
  "midnight-moon": { family: "og-neumorphic", cardTheme: "moon" },
  "hitachi-solutions": { family: "og-neumorphic", cardTheme: "ice" },
  "bubble-gem": { family: "premium-gotham", cardTheme: "carbon-diamond" },
  "frosted-crystal": { family: "ocean-gradient", cardTheme: "teal" },
  "dark-cinematic": { family: "elegant-dark", cardTheme: "original" },
};

const SIDEBAR_THEME_FAMILIES = new Set([
  "elegant-dark",
  "modern-minimalist",
  "simple-classico",
  "bubble-glass",
  "floral-madness",
  "ocean-gradient",
  "premium-gotham",
  "royal-purple",
  "luxurious-editorial",
  "nouveau-riche",
  "og-neumorphic",
]);

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const cookies = document.cookie ? document.cookie.split("; ") : [];
  for (const cookie of cookies) {
    const [rawKey, ...rest] = cookie.split("=");
    const key = decodeURIComponent(rawKey || "").trim();
    if (key !== name) continue;
    return decodeURIComponent(rest.join("=") || "").trim() || null;
  }
  return null;
}

async function ensureCsrfToken(apiBase: string): Promise<string | null> {
  const fromCookie = readCookie(CSRF_COOKIE_NAME);
  if (fromCookie) return fromCookie;

  try {
    const response = await fetch(`${apiBase}/api/csrf-token`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return readCookie(CSRF_COOKIE_NAME);
    const payload = (await response.json()) as Record<string, unknown>;
    const data =
      payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : null;
    const token =
      (typeof payload.csrfToken === "string" && payload.csrfToken) ||
      (typeof payload.csrf_token === "string" && payload.csrf_token) ||
      (typeof payload.token === "string" && payload.token) ||
      (data && typeof data.csrfToken === "string" ? data.csrfToken : null);
    return token?.trim() || readCookie(CSRF_COOKIE_NAME);
  } catch {
    return readCookie(CSRF_COOKIE_NAME);
  }
}

async function authFetch(
  apiBase: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = String(init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers ?? undefined);
  if (method !== "GET" && method !== "HEAD") {
    const csrfToken = await ensureCsrfToken(apiBase);
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  }
  return fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...init,
    method,
    headers: withImpersonationHeaders(headers),
  });
}

/** Persist portfolio theme slug to bizcard_theme via theme-only APIs. */
export async function persistThemePath(
  themeId: string,
  apiBase: string = getFrontendApiBaseUrl(),
): Promise<boolean> {
  const normalizedTheme = normalizePortfolioThemeId(themeId);
  if (!normalizedTheme) return false;

  // Prefer theme-only endpoints so profile fields (services/socials) are never touched.
  const designResponse = await authFetch(apiBase, `${apiBase}/api/vcard/design/theme`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme_path: normalizedTheme }),
  });

  if (designResponse.ok) return true;

  const designError = await designResponse
    .clone()
    .json()
    .catch(async () => ({ raw: await designResponse.text().catch(() => null) }));

  const updateResponse = await authFetch(apiBase, `${apiBase}/api/bizcard/update`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bizcard_theme: normalizedTheme }),
  });

  if (updateResponse.ok) return true;

  const updateError = await updateResponse
    .clone()
    .json()
    .catch(async () => ({ raw: await updateResponse.text().catch(() => null) }));

  // Last resort: profile PUT with theme only (services/socials omitted stay untouched).
  const profileResponse = await authFetch(apiBase, `${apiBase}/api/vcard/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ themePath: normalizedTheme }),
  });

  if (profileResponse.ok) return true;

  const profileError = await profileResponse
    .clone()
    .json()
    .catch(async () => ({ raw: await profileResponse.text().catch(() => null) }));

  console.error("[persistThemePath] Theme persistence failed", {
    designStatus: designResponse.status,
    designError,
    updateStatus: updateResponse.status,
    updateError,
    profileStatus: profileResponse.status,
    profileError,
    theme: normalizedTheme,
  });
  return false;
}

export function readPortfolioTheme(urlAlias: string): string | null {
  if (!urlAlias || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`portfolio_${urlAlias.trim()}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { selectedTheme?: unknown };
    const theme =
      typeof parsed.selectedTheme === "string" ? parsed.selectedTheme.trim() : "";
    return theme || null;
  } catch {
    return null;
  }
}

/** Returns cached theme only when a recent owner edit occurred (within RECENT_THEME_OVERRIDE_MS). */
export function readRecentPortfolioTheme(urlAlias: string): string | null {
  if (!urlAlias || typeof window === "undefined") return null;
  try {
    const tsRaw = localStorage.getItem(PORTFOLIO_REFRESH_STORAGE_KEY);
    const ts = Number(tsRaw ?? "0");
    if (!Number.isFinite(ts) || ts <= 0) return null;
    if (Date.now() - ts > RECENT_THEME_OVERRIDE_MS) return null;
    const cached = readPortfolioTheme(urlAlias);
    if (!cached) return null;
    return normalizePortfolioThemeId(cached) || cached;
  } catch {
    return null;
  }
}

export function resolveSidebarTheme(themeId: string): SidebarThemeResolve {
  const normalized = normalizePortfolioThemeId(themeId) || themeId.trim().toLowerCase();
  if (SIDEBAR_THEME_RESOLVE[normalized]) {
    return SIDEBAR_THEME_RESOLVE[normalized];
  }
  if (SIDEBAR_THEME_FAMILIES.has(normalized)) {
    return { family: normalized };
  }
  return SIDEBAR_THEME_RESOLVE["elegant-dark"];
}

/** Resolve active theme from API/DB only — browser snapshots are never authoritative. */
export function resolveActiveCardTheme(apiTheme: string, _urlAlias?: string): string {
  return normalizePortfolioThemeId(apiTheme) || apiTheme.trim() || "elegant-dark";
}

export function publishBizcardThemeToCache(params: {
  urlAlias: string;
  themeId: string;
  bizcardId?: string;
  serialId?: string;
  bizcardName?: string;
}): void {
  if (typeof window === "undefined") return;

  const normalizedAlias = params.urlAlias.trim();
  const normalizedTheme = params.themeId.trim();
  if (!normalizedAlias || !normalizedTheme) return;

  try {
    // Do not write portfolio_* display blobs — live pages always refetch from the API.
    markPortfolioNeedsServerRefresh();

    if (params.bizcardId) {
      const cached = getLastAccessedBizcards();
      const match = cached.find((entry) => entry.bizcard_id === params.bizcardId);
      if (match) {
        recordLastAccessedBizcard({
          ...match,
          bizcard_name: resolveBizcardDisplayName({
            bizcard_name: params.bizcardName ?? match.bizcard_name,
          }) || match.bizcard_name,
          bizcard_theme: normalizedTheme,
          accessed_at: new Date().toISOString(),
        });
      } else if (params.serialId) {
        recordLastAccessedBizcard({
          bizcard_id: params.bizcardId,
          serial_id: params.serialId,
          bizcard_name: resolveBizcardDisplayName({
            bizcard_name: params.bizcardName ?? "",
          }),
          bizcard_theme: normalizedTheme,
        });
      }
    }

    try {
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(PORTFOLIO_BROADCAST_CHANNEL);
        channel.postMessage({ alias: normalizedAlias, themeId: normalizedTheme });
        channel.close();
      }
    } catch {
      // ignore
    }

    window.dispatchEvent(new CustomEvent(USER_SYNC_EVENT));
  } catch {
    // ignore local cache write failures
  }
}

export function publishPortfolioSnapshotUpdate(params: {
  urlAlias: string;
  updater: (existing: Record<string, unknown>) => Record<string, unknown>;
}): void {
  if (typeof window === "undefined") return;

  const normalizedAlias = params.urlAlias.trim();
  if (!normalizedAlias) return;

  try {
    // Intentionally do not persist portfolio_* display blobs.
    // Callers may still pass an updater for API-shaped payloads used elsewhere;
    // live portfolio pages always refetch from the server.
    void params.updater({});
    markPortfolioNeedsServerRefresh();
    window.dispatchEvent(new CustomEvent(USER_SYNC_EVENT));

    if (typeof BroadcastChannel !== "undefined") {
      const broadcast = new BroadcastChannel(PORTFOLIO_BROADCAST_CHANNEL);
      broadcast.postMessage({ alias: normalizedAlias });
      broadcast.close();
    }
  } catch {
    // ignore cache/broadcast failures
  }
}

export function dispatchUserSync(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(USER_SYNC_EVENT));
}
