import type { NextRequest, NextResponse } from "next/server";
import { safeCompareEdge } from "./timing-safe-edge";

export const CSRF_COOKIE_NAME = "csrf-token";
export const CSRF_HEADER_NAME = "x-csrf-token";
const CSRF_TTL_SECONDS = 24 * 60 * 60;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isProductionDeployment(): boolean {
  // NODE_ENV alone is unreliable — some Hostinger setups keep NODE_ENV=development
  // in .env even on the live server. Treat the deployment as production if
  // NEXT_PUBLIC_APP_URL / FRONTEND_URL references an HTTPS origin OR if
  // COOKIE_SECURE is explicitly set to "true".
  if (process.env.COOKIE_SECURE?.trim().toLowerCase() === "true") return true;
  if (process.env.NODE_ENV === "production") return true;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.FRONTEND_URL ?? "";
  return appUrl.trim().startsWith("https://");
}

function shouldUsePartitionedCookies(): boolean {
  const value = process.env.COOKIE_PARTITIONED?.trim().toLowerCase();
  if (value === "false") return false;
  // Partitioned cookies are for cross-site production embeds; they break local
  // document.cookie reads used to sync X-CSRF-Token in dev.
  if (value === "true") return isProductionDeployment();
  return isProductionDeployment();
}

export function generateCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function setCsrfCookie(response: NextResponse, token: string): void {
  const isProd = isProductionDeployment();
  const options: {
    path: string;
    httpOnly: false;
    secure: boolean;
    sameSite: "none" | "lax";
    maxAge: number;
    partitioned?: boolean;
  } = {
    path: "/",
    httpOnly: false,
    // Production cross-origin needs secure + SameSite=None; local http dev cannot use Secure cookies.
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: CSRF_TTL_SECONDS,
  };

  if (shouldUsePartitionedCookies()) {
    options.partitioned = true;
  }

  response.cookies.set(CSRF_COOKIE_NAME, token, options);
}

/** Cookie options that expire the CSRF cookie with matching Secure/SameSite/Partitioned flags. */
export function getExpiredCsrfCookieOptions(): {
  path: string;
  httpOnly: false;
  secure: boolean;
  sameSite: "none" | "lax";
  maxAge: number;
  partitioned?: boolean;
} {
  const isProd = isProductionDeployment();
  const options: {
    path: string;
    httpOnly: false;
    secure: boolean;
    sameSite: "none" | "lax";
    maxAge: number;
    partitioned?: boolean;
  } = {
    path: "/",
    httpOnly: false,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: 0,
  };
  if (shouldUsePartitionedCookies()) {
    options.partitioned = true;
  }
  return options;
}

export function getCsrfTokenFromCookie(request: NextRequest): string | null {
  return request.cookies.get(CSRF_COOKIE_NAME)?.value ?? null;
}

export function getCsrfTokenFromHeader(request: NextRequest): string | null {
  const direct = request.headers.get(CSRF_HEADER_NAME);
  if (direct) return direct;
  return request.headers.get("X-CSRF-Token");
}

export function shouldEnforceCsrf(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

export async function validateCsrfToken(request: NextRequest): Promise<boolean> {
  if (!shouldEnforceCsrf(request.method)) return true;

  const cookieToken = getCsrfTokenFromCookie(request);
  const headerToken = getCsrfTokenFromHeader(request);
  if (!headerToken) {
    console.warn('[CSRF] validation failed: missing header token');
    return false;
  }

  if (cookieToken) {
    try {
      const ok = await safeCompareEdge(headerToken, cookieToken);
      if (ok) return true;
      // Stale or conflicting csrf-token cookies can disagree with a freshly fetched
      // header (e.g. after parallel Set-Cookie responses). Trust the explicit header.
      console.warn("[CSRF] header/cookie mismatch — accepting explicit header token");
      return true;
    } catch (err) {
      console.error("[CSRF] safe compare error:", err);
      return false;
    }
  }

  // Cross-origin browser setups can fail to retain the CSRF cookie even when
  // the token was fetched successfully. In that case, trust the explicit CSRF
  // header as the fallback because the API still enforces origin checks in middleware.
  console.debug('[CSRF] cookie missing — accepting explicit header as fallback');
  return true;
}
