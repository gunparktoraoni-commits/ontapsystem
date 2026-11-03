/**
 * Centralized CSRF token management
 * Standardizes CSRF handling across the application
 * Follows secure cookie + header attachment pattern
 */

const CSRF_COOKIE_NAME = "csrf-token";

function clearCsrfCookie(): void {
  if (typeof document === "undefined") return;
  const expires = "Thu, 01 Jan 1970 00:00:00 GMT";
  // Match all attribute combinations used when the cookie was issued
  // (Lax local, None+Secure prod, Partitioned CHIPS) so Safari/Chrome actually delete it.
  const variants = [
    `${CSRF_COOKIE_NAME}=; path=/; expires=${expires}; max-age=0; SameSite=Lax`,
    `${CSRF_COOKIE_NAME}=; path=/; expires=${expires}; max-age=0; SameSite=Lax; Secure`,
    `${CSRF_COOKIE_NAME}=; path=/; expires=${expires}; max-age=0; SameSite=None; Secure`,
    `${CSRF_COOKIE_NAME}=; path=/; expires=${expires}; max-age=0; SameSite=None; Secure; Partitioned`,
  ];
  for (const cookie of variants) {
    try {
      document.cookie = cookie;
    } catch {
      // ignore
    }
  }
}

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

/**
 * Retrieve CSRF token from cookie or fetch fresh one
 * @param forceFetch - Force fresh token fetch
 * @param apiBaseUrl - API base URL (defaults to env var)
 * @returns CSRF token or null
 */
async function getToken(
  forceFetch = false,
  apiBaseUrl?: string
): Promise<string | null> {
  const base =
    (apiBaseUrl ?? "").replace(/\/+$/, "") ||
    (typeof window !== "undefined" ? window.location.origin.replace(/\/+$/, "") : "");

  if (!forceFetch) {
    const fromCookie = readCookie(CSRF_COOKIE_NAME);
    if (fromCookie) {
      return fromCookie;
    }
  } else {
    clearCsrfCookie();
  }

  if (!base) {
    return readCookie(CSRF_COOKIE_NAME);
  }

  try {
    const csrfEndpoint = `${base}/api/csrf-token`;
    const res = await fetch(csrfEndpoint, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });

    if (!res.ok) return readCookie(CSRF_COOKIE_NAME);

    const payload = (await res.json().catch(() => null)) as any;
    const data =
      payload?.data && typeof payload.data === "object" ? payload.data : null;
    const bodyToken =
      payload?.csrfToken ||
      payload?.csrf_token ||
      payload?.token ||
      (data && (data.csrfToken || data.csrf_token)) ||
      null;
    const normalizedBody =
      typeof bodyToken === "string" && bodyToken.trim() ? bodyToken.trim() : null;

    if (forceFetch) {
      // Authoritative token comes from /api/csrf-token response body.
      return normalizedBody || readCookie(CSRF_COOKIE_NAME);
    }

    const syncedCookie = readCookie(CSRF_COOKIE_NAME);
    return syncedCookie || normalizedBody;
  } catch (err) {
    console.warn("[CSRF_CLIENT] Token fetch failed, using cookie fallback", err);
    return readCookie(CSRF_COOKIE_NAME);
  }
}

/**
 * Build Headers object with CSRF token in all accepted formats
 * @param token - CSRF token to attach
 * @returns Headers object with CSRF attached
 */
function buildHeaders(token: string | null): Headers {
  const headers = new Headers();
  if (token) {
    // Attach CSRF in multiple header names for compatibility
    headers.set("X-CSRF-Token", token);
    headers.set("x-csrf-token", token);
    headers.set("X-XSRF-TOKEN", token);
    headers.set("x-xsrf-token", token);
    headers.set("csrf-token", token);
  }
  return headers;
}

/**
 * Build complete fetch options with CSRF token and credentials
 * @param method - HTTP method
 * @param body - Request body (will be JSON stringified)
 * @param forceFetch - Force fresh CSRF token
 * @param apiBaseUrl - API base URL
 * @returns RequestInit options ready for fetch()
 */
async function getFetchOptions(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
  forceFetch = false,
  apiBaseUrl?: string
): Promise<RequestInit> {
  const token = await getToken(forceFetch, apiBaseUrl);
  const headers = buildHeaders(token);
  headers.set("Content-Type", "application/json");

  const requestInit: RequestInit = {
    method,
    credentials: "include",
    cache: "no-store",
    headers,
  };

  if (body !== undefined) {
    requestInit.body = JSON.stringify(body);
  }

  return requestInit;
}

export const csrfClient = {
  getToken,
  buildHeaders,
  getFetchOptions,
  readCookie,
  clearCsrfCookie,
};
