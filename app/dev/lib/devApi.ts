"use client";

import { csrfClient } from "@/lib/csrf-client";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";

const API = getFrontendApiBaseUrl();

type DevApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type DevApiResult<T = unknown> = {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  code: string | null;
  raw: unknown;
};

function isCsrfFailure(status: number, payload: unknown): boolean {
  if (status !== 403) return false;
  if (!payload || typeof payload !== "object") return false;
  const record = payload as { code?: string; error?: string };
  if (record.code === "CSRF_TOKEN_INVALID" || record.code === "INVALID_CSRF_TOKEN") {
    return true;
  }
  return typeof record.error === "string" && /csrf/i.test(record.error);
}

function isUnauthorized(status: number): boolean {
  return status === 401;
}

function extractError(payload: unknown, status: number): { message: string; code: string | null } {
  if (payload && typeof payload === "object") {
    const record = payload as { error?: unknown; message?: unknown; code?: unknown };
    const message =
      (typeof record.error === "string" && record.error.trim()) ||
      (typeof record.message === "string" && record.message.trim()) ||
      `Request failed (${status})`;
    const code = typeof record.code === "string" ? record.code : null;
    return { message, code };
  }
  if (status === 0) {
    return {
      message: "Network error. Check your connection and try again.",
      code: "NETWORK_ERROR",
    };
  }
  return { message: `Request failed (${status})`, code: null };
}

async function tryRefreshSession(): Promise<boolean> {
  try {
    const refreshUrl = `${API}/api/auth/refresh`;
    const res = await fetch(refreshUrl, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: await (async () => {
        const token = await csrfClient.getToken(false, API || undefined);
        return csrfClient.buildHeaders(token);
      })(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * CSRF-safe fetch for the Developer Portal.
 * Always sends credentials, attaches CSRF for mutations, retries on CSRF/401.
 */
export async function devApiFetch(
  path: string,
  options: {
    method?: DevApiMethod;
    body?: unknown;
    forceCsrf?: boolean;
    headers?: HeadersInit;
    signal?: AbortSignal;
  } = {},
): Promise<Response> {
  const method = (options.method ?? "GET").toUpperCase() as DevApiMethod;
  const url = path.startsWith("http") ? path : `${API}${path}`;
  const isMutating = method !== "GET";
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;

  const buildInit = async (forceCsrf: boolean): Promise<RequestInit> => {
    const headers = new Headers(options.headers);

    if (isMutating) {
      const token = await csrfClient.getToken(forceCsrf, API || undefined);
      const csrfHeaders = csrfClient.buildHeaders(token);
      csrfHeaders.forEach((value, key) => {
        headers.set(key, value);
      });
      // Let the browser set multipart boundaries for FormData.
      if (options.body !== undefined && !isFormData && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
    }

    const init: RequestInit = {
      method,
      credentials: "include",
      cache: "no-store",
      headers,
      signal: options.signal,
    };

    if (options.body !== undefined) {
      init.body =
        typeof options.body === "string" || isFormData
          ? (options.body as BodyInit)
          : JSON.stringify(options.body);
    }

    return init;
  };

  let init = await buildInit(Boolean(options.forceCsrf));
  let response: Response;

  try {
    response = await fetch(url, init);
  } catch (error) {
    // Normalize connectivity failures into a Response-like path via throw;
    // callers of devApiJson catch this and map to NETWORK_ERROR.
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Request was cancelled."
        : "Network error. Check your connection and try again.";
    throw new Error(message);
  }

  // CSRF retry with a freshly issued token.
  if (isMutating && response.status === 403) {
    const payload = await response.clone().json().catch(() => ({}));
    if (isCsrfFailure(response.status, payload)) {
      init = await buildInit(true);
      response = await fetch(url, init);
    }
  }

  // One session-refresh retry on 401 (expired session cookie).
  if (isUnauthorized(response.status) && !url.includes("/api/auth/")) {
    const refreshed = await tryRefreshSession();
    if (refreshed) {
      init = await buildInit(isMutating);
      response = await fetch(url, init);
    }
  }

  return response;
}

export async function devApiJson<T = unknown>(
  path: string,
  options: Parameters<typeof devApiFetch>[1] = {},
): Promise<DevApiResult<T>> {
  try {
    const response = await devApiFetch(path, options);
    const raw = await response.json().catch(() => ({}));
    const success = response.ok && (raw as { success?: boolean })?.success !== false;

    if (!success) {
      const { message, code } = extractError(raw, response.status);
      return {
        ok: false,
        status: response.status,
        data: null,
        error: message,
        code,
        raw,
      };
    }

    // Envelope APIs use `{ data }`; some dashboard routes return the payload at the root.
    const hasDataKey =
      raw !== null && typeof raw === "object" && !Array.isArray(raw) && "data" in raw;
    const data = (hasDataKey ? (raw as { data?: T }).data ?? null : (raw as T)) as T | null;

    return {
      ok: true,
      status: response.status,
      data,
      error: null,
      code: null,
      raw,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Network error. Check your connection and try again.";
    return {
      ok: false,
      status: 0,
      data: null,
      error: message,
      code: "NETWORK_ERROR",
      raw: null,
    };
  }
}
