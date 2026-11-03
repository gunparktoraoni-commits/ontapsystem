import { csrfClient } from "@/lib/csrf-client";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";

let refreshInFlight: Promise<boolean> | null = null;

function getApiBase(): string {
    return getFrontendApiBaseUrl();
}

function resolveUrl(input: string | URL | Request): string | URL | Request {
    if (typeof input !== "string" || !input.startsWith("/")) return input;
    const base = getApiBase();
    return base ? `${base}${input}` : input;
}

function isCsrfFailure(status: number, payload: unknown): boolean {
    if (status !== 403) return false;
    if (!payload || typeof payload !== "object") return false;
    const record = payload as { code?: string; error?: string };
    if (record.code === "CSRF_TOKEN_INVALID" || record.code === "INVALID_CSRF_TOKEN") {
        return true;
    }
    return typeof record.error === "string" && /csrf/i.test(record.error);
}

async function attachCsrfHeaders(headers: Headers, forceRefresh = false): Promise<void> {
    const apiBase = getApiBase();
    const csrf = await csrfClient.getToken(forceRefresh, apiBase || undefined);
    if (!csrf) return;
    headers.set("X-CSRF-Token", csrf);
    headers.set("x-csrf-token", csrf);
}

async function tryRefreshSession(): Promise<boolean> {
    if (refreshInFlight) {
        return refreshInFlight;
    }

    refreshInFlight = (async () => {
        try {
            const apiBase = getApiBase();
            const refreshUrl = apiBase ? `${apiBase}/api/auth/refresh` : "/api/auth/refresh";
            const res = await fetch(refreshUrl, {
                method: "POST",
                credentials: "include",
            });
            return res.ok;
        } catch {
            return false;
        } finally {
            refreshInFlight = null;
        }

    })();


    return refreshInFlight;

}


export async function apiFetch(
    input: string | URL | Request,
    init?: RequestInit,

): Promise<Response> {
    

    const url = resolveUrl(input);
    const method = String(init?.method ?? "GET").trim().toUpperCase();
    const isStateChanging = ["POST", "PUT", "PATCH", "DELETE"].includes(method);


    const headers = new Headers(init?.headers ?? {});
    if (init?.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }
    if (isStateChanging) {
        await attachCsrfHeaders(headers, false);
    }

    let response = await fetch(url, { credentials: "include", ...init, headers });

    if (isStateChanging && response.status === 403) {
        const csrfPayload = await response.clone().json().catch(() => null);
        if (isCsrfFailure(response.status, csrfPayload)) {
            const retryHeaders = new Headers(init?.headers ?? {});
            if (init?.body && !retryHeaders.has("Content-Type")) {
                retryHeaders.set("Content-Type", "application/json");
            }
            await attachCsrfHeaders(retryHeaders, true);
            response = await fetch(url, { credentials: "include", ...init, headers: retryHeaders });
        }
    }

    // Avoid infinite retry loops for auth endpoints themselves.
    const isAuthRoute =
        typeof url === "string" &&
        /\/api\/auth\/(login|logout|refresh|session|session-health|resend-otp|verify-email|verify|resend-verification)$/.test(url);
    if (response.status !== 401 || isAuthRoute) {
        return response;
    }

    const refreshed = await tryRefreshSession();
    if (!refreshed) {
        if (typeof window !== "undefined") {
            window.location.href = "/login";
        }
        return response;
    }

    const retryHeaders = new Headers(init?.headers ?? {});
    if (init?.body && !retryHeaders.has("Content-Type")) {
        retryHeaders.set("Content-Type", "application/json");
    }
    if (isStateChanging) {
        await attachCsrfHeaders(retryHeaders, false);
    }

    return fetch(url, { credentials: "include", ...init, headers: retryHeaders });
}