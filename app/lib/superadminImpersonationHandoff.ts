export const IMPERSONATION_HANDOFF_KEY = "superadmin_impersonation_handoff_token";
export const IMPERSONATION_HANDOFF_COOKIE = "superadmin_impersonation_handoff";
export const IMPERSONATION_COMPANY_ID_KEY = "superadmin_impersonation_company_id";
export const IMPERSONATION_USER_ID_KEY = "superadmin_impersonation_user_id";

export function readHandoffCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/([.*+?^${}()|[\]\\])/g, "\\$1")}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export function readImpersonationHandoffToken(): string | null {
  if (typeof window === "undefined") return null;
  const fromStorage = window.sessionStorage.getItem(IMPERSONATION_HANDOFF_KEY)?.trim();
  if (fromStorage) return fromStorage;
  const fromCookie = readHandoffCookie(IMPERSONATION_HANDOFF_COOKIE)?.trim();
  return fromCookie || null;
}

export function readImpersonationCompanyId(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(IMPERSONATION_COMPANY_ID_KEY)?.trim() || null;
}

export function readImpersonationUserId(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(IMPERSONATION_USER_ID_KEY)?.trim() || null;
}

export function persistImpersonationHandoff(
  token: string,
  companyId?: string,
  userId?: string,
): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(IMPERSONATION_HANDOFF_KEY, token);
  if (companyId) {
    window.sessionStorage.setItem(IMPERSONATION_COMPANY_ID_KEY, companyId);
  }
  if (userId) {
    window.sessionStorage.setItem(IMPERSONATION_USER_ID_KEY, userId);
  }
}

export function clearImpersonationHandoff(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(IMPERSONATION_HANDOFF_KEY);
  window.sessionStorage.removeItem(IMPERSONATION_COMPANY_ID_KEY);
  window.sessionStorage.removeItem(IMPERSONATION_USER_ID_KEY);
  const expires = "Thu, 01 Jan 1970 00:00:00 GMT";
  const variants = [
    `${IMPERSONATION_HANDOFF_COOKIE}=; path=/; expires=${expires}; max-age=0; SameSite=Lax`,
    `${IMPERSONATION_HANDOFF_COOKIE}=; path=/; expires=${expires}; max-age=0; SameSite=Lax; Secure`,
    `${IMPERSONATION_HANDOFF_COOKIE}=; path=/; expires=${expires}; max-age=0; SameSite=None; Secure`,
    `${IMPERSONATION_HANDOFF_COOKIE}=; path=/; expires=${expires}; max-age=0; SameSite=None; Secure; Partitioned`,
  ];
  for (const cookie of variants) {
    try {
      document.cookie = cookie;
    } catch {
      // ignore
    }
  }
}

export function buildImpersonationHeaders(): HeadersInit {
  const token = readImpersonationHandoffToken();
  return token ? { "x-impersonation-token": token } : {};
}

export function withImpersonationHeaders(headers: HeadersInit = {}): HeadersInit {
  const token = readImpersonationHandoffToken();
  if (!token) return headers;

  const normalizedHeaders = headers instanceof Headers ? headers : new Headers(headers);
  if (!normalizedHeaders.has("x-impersonation-token")) {
    normalizedHeaders.set("x-impersonation-token", token);
  }

  return normalizedHeaders;
}

export function readHandoffTokenFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "").trim();
  if (!hash.startsWith("handoff=")) return null;
  const value = hash.slice("handoff=".length).trim();
  return value ? decodeURIComponent(value) : null;
}
