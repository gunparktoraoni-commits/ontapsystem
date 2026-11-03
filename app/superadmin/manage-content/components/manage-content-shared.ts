"use client";

import { getFrontendApiBaseUrl } from "@/app/components/apiBase";

const CSRF_COOKIE_NAME = "csrf-token";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const API_BASE = getFrontendApiBaseUrl();

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/([.*+?^${}()|[\]\\])/g, "\\$1")}=([^;]*)`)
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function readStoredToken(): string | null {
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

async function ensureCsrfToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const fromCookie = readCookie(CSRF_COOKIE_NAME);
  if (fromCookie) return fromCookie;

  try {
    const response = await fetch(`${API_BASE}/api/csrf-token`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return readCookie(CSRF_COOKIE_NAME);
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const data =
      payload && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : null;
    const token =
      (payload && typeof payload.csrfToken === "string" && payload.csrfToken) ||
      (payload && typeof payload.csrf_token === "string" && payload.csrf_token) ||
      (payload && typeof payload.token === "string" && payload.token) ||
      (data && typeof data.csrfToken === "string" && data.csrfToken) ||
      null;
    return token?.trim() || readCookie(CSRF_COOKIE_NAME);
  } catch {
    return readCookie(CSRF_COOKIE_NAME);
  }
}

export async function manageContentRequest(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const token = readStoredToken();
  const method = String(init?.method ?? "GET").trim().toUpperCase();
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const headers = new Headers(init?.headers ?? undefined);

  if (init?.body && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (MUTATING_METHODS.has(method)) {
    const csrfToken = await ensureCsrfToken();
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  }

  return fetch(`${API_BASE}${path}`, {
    ...init,
    method,
    credentials: "include",
    cache: "no-store",
    headers,
  });
}

export function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function fmtCurrency(n: number) {
  return n
    .toLocaleString("en-US", { style: "currency", currency: "USD" })
    .replace(/\$/g, "₱");
}

export function fmtDate(d: string) {
  if (!d) return "—";
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function toDateInput(value: unknown): string {
  const raw = safeString(value);
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

export function toDateTimeLocal(value: unknown): string {
  const raw = safeString(value);
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  const offset = parsed.getTimezoneOffset();
  const local = new Date(parsed.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

export function normalizeList(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => safeString(item)).filter(Boolean);
  }
  const raw = safeString(input);
  if (!raw) return [];
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

export function extractKeyList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "key" in item) {
        return safeString((item as Record<string, unknown>).key);
      }
      return "";
    })
    .filter(Boolean);
}

export type ManageContentTab =
  | "products"
  | "subscription"
  | "offers"
  | "newsletter";

export const MANAGE_CONTENT_TABS: Array<{
  id: ManageContentTab;
  label: string;
}> = [
  { id: "products", label: "Products" },
  { id: "subscription", label: "Subscription" },
  { id: "offers", label: "Limited Time Offers" },
  { id: "newsletter", label: "Newsletter and Promotional" },
];
