// Centralized API client for the SuperAdmin Dashboard.
// Uses same-origin in local development so session cookies work.

import { getFrontendApiBaseUrl } from "@/app/components/apiBase";

export const BACKEND_URL = getFrontendApiBaseUrl();

function resolveBackendUrl(): string {
  // Prefer live origin in the browser (avoids baking production URL into local dev).
  if (typeof window !== "undefined") {
    return getFrontendApiBaseUrl();
  }
  return BACKEND_URL;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=")[1]) : null;
}

function readAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return (
    window.localStorage.getItem("auth_token") ||
    window.localStorage.getItem("superadmin_token") ||
    window.sessionStorage.getItem("auth_token") ||
    window.sessionStorage.getItem("superadmin_token") ||
    readCookie("auth_token") ||
    readCookie("superadmin_token") ||
    null
  );
}

export type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: string | { message?: string };
  message?: string;
  meta?: Record<string, unknown>;
};
export async function fetchSuperAdmin<T = unknown>(
  path: string,
  init?: RequestInit,
  signal?: AbortSignal
): Promise<ApiEnvelope<T>> {
  const token = readAuthToken();
  const base = resolveBackendUrl();
  const url = path.startsWith("http")
    ? path
    : `${base}${path.startsWith("/") ? "" : "/"}${path}`;

  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    signal,
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  let payload: ApiEnvelope<T> = {};
  try {
    payload = text ? (JSON.parse(text) as ApiEnvelope<T>) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const message =
      (typeof payload.error === 'string' && payload.error) ||
      (typeof payload.error === 'object' && payload.error?.message) ||
      payload.message ||
      `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

export type DateFilter =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'this_year'
  | 'custom';

export function buildDateRangeQuery(filter?: DateFilter, start?: string, end?: string): string {
  const params = new URLSearchParams();
  if (filter) params.set('date_filter', filter);
  if (start) params.set('custom_start_date', start);
  if (end) params.set('custom_end_date', end);
  const q = params.toString();
  return q ? `?${q}` : '';
}


export function fetchDashboardMetrics(
  filter: DateFilter = 'this_month',
  signal?: AbortSignal,
  customRange?: { start: string; end: string }
) {
  const query =
    filter === 'custom' && customRange?.start && customRange?.end
      ? buildDateRangeQuery('custom', customRange.start, customRange.end)
      : buildDateRangeQuery(filter);
  return fetchSuperAdmin<Record<string, unknown>>(
    `/api/superadmin/dashboard/metrics${query}`,
    undefined,
    signal
  );
}

export function fetchClientsSummary(signal?: AbortSignal) {
  return fetchSuperAdmin<Record<string, unknown>>(
    `/api/superadmin/clients/summary`,
    undefined,
    signal
  );
}

export type StaffRoleKey = 'web_developer' | 'sales_rep' | 'admin' | 'support_agent' | 'analyst';
export function fetchStaffList(
  options: {
    page?: number;
    limit?: number;
    role?: StaffRoleKey;
    search?: string;
  } = {},
  signal?: AbortSignal
) {
  const params = new URLSearchParams();
  params.set('page', String(options.page ?? 1));
  params.set('limit', String(options.limit ?? 50));
  if (options.role) params.set('role', options.role);
  if (options.search) params.set('search', options.search);
  return fetchSuperAdmin<Record<string, unknown>>(
    `/api/superadmin/staff?${params.toString()}`,
    undefined,
    signal
  );
}
// Staff analytics — GET /api/superadmin/staff/analytics
export function fetchStaffAnalytics(signal?: AbortSignal) {
  return fetchSuperAdmin<Record<string, unknown>>(
    `/api/superadmin/staff/analytics`,
    undefined,
    signal
  );
}

// Staff activities — GET /api/superadmin/staff-activities
export function fetchStaffActivities(
  options: { page?: number; limit?: number; filter?: DateFilter; search?: string } = {},
  signal?: AbortSignal
) {
  const params = new URLSearchParams();
  params.set('page', String(options.page ?? 1));
  params.set('limit', String(options.limit ?? 100));
  if (options.filter) params.set('date_filter', options.filter);
  if (options.search) params.set('search', options.search);
  return fetchSuperAdmin<Record<string, unknown>>(
    `/api/superadmin/staff-activities?${params.toString()}`,
    undefined,
    signal
  );
}

export function fetchRecentActivities(
  options: { page?: number; limit?: number; filter?: DateFilter; activityType?: string } = {},
  signal?: AbortSignal
) {
  const params = new URLSearchParams();
  params.set('page', String(options.page ?? 1));
  params.set('limit', String(options.limit ?? 20));
  if (options.filter) params.set('date_filter', options.filter);
  if (options.activityType) params.set('activity_type', options.activityType);
  return fetchSuperAdmin<Record<string, unknown>>(
    `/api/superadmin/dashboard/recent-activities?${params.toString()}`,
    undefined,
    signal
  );
}

// ---------- Type guards / helpers ----------

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function pickNumber(...values: unknown[]): number | null {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return null;
}

export function pickString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export function pickArray(...values: unknown[]): unknown[] | null {
  for (const v of values) {
    if (Array.isArray(v)) return v;
  }
  return null;
}

export function formatPercentDelta(value: number | null, fallback = '+0.0%'): string {
  if (value === null || !Number.isFinite(value)) return fallback;
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}
