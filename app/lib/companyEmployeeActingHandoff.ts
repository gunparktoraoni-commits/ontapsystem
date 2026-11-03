export const COMPANY_ACTING_HANDOFF_KEY = "company_employee_acting_handoff_token";
export const COMPANY_ACTING_EMPLOYEE_ID_KEY = "company_employee_acting_employee_id";
export const COMPANY_ACTING_USER_ID_KEY = "company_employee_acting_user_id";
export const COMPANY_ACTING_HEADER_NAME = "x-company-acting-token";
export const COMPANY_ACTING_HANDOFF_COOKIE = "company_employee_acting_handoff";

function readHandoffCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/([.*+?^${}()|[\]\\])/g, "\\$1")}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export function readCompanyActingToken(): string | null {
  if (typeof window === "undefined") return null;
  const fromStorage = window.sessionStorage.getItem(COMPANY_ACTING_HANDOFF_KEY)?.trim();
  if (fromStorage) return fromStorage;
  return readHandoffCookie(COMPANY_ACTING_HANDOFF_COOKIE)?.trim() || null;
}

export function persistCompanyActingHandoff(
  token: string,
  employeeId?: string,
  userId?: string,
): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(COMPANY_ACTING_HANDOFF_KEY, token);
  if (employeeId) {
    window.sessionStorage.setItem(COMPANY_ACTING_EMPLOYEE_ID_KEY, employeeId);
  }
  if (userId) {
    window.sessionStorage.setItem(COMPANY_ACTING_USER_ID_KEY, userId);
  }
}

export function clearCompanyActingHandoff(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(COMPANY_ACTING_HANDOFF_KEY);
  window.sessionStorage.removeItem(COMPANY_ACTING_EMPLOYEE_ID_KEY);
  window.sessionStorage.removeItem(COMPANY_ACTING_USER_ID_KEY);
}

export function buildCompanyActingHeaders(): HeadersInit {
  const token = readCompanyActingToken();
  return token ? { [COMPANY_ACTING_HEADER_NAME]: token } : {};
}

export function withCompanyActingHeaders(headers: HeadersInit = {}): HeadersInit {
  const token = readCompanyActingToken();
  if (!token) return headers;

  const normalizedHeaders = headers instanceof Headers ? headers : new Headers(headers);
  if (!normalizedHeaders.has(COMPANY_ACTING_HEADER_NAME)) {
    normalizedHeaders.set(COMPANY_ACTING_HEADER_NAME, token);
  }
  return normalizedHeaders;
}
