import { NextRequest, NextResponse } from "next/server";

import {
  SSO_STATE_COOKIE_NAME,
  SSO_STATE_COOKIE_PATH,
  safeOrigin,
} from "@/server/lib/cross-portal-sso-policy";

export type SuperLoginNotice = "none" | "failed" | "unavailable";

/**
 * Public origin of the OnTap portal. Behind Hostinger's proxy `req.url` can be
 * an internal host, so prefer the configured public URL.
 */
export function ontapPublicOrigin(req: NextRequest): string {
  return (
    safeOrigin(process.env.NEXT_PUBLIC_APP_URL) ??
    safeOrigin(process.env.FRONTEND_URL) ??
    req.nextUrl.origin
  );
}

export function superLoginUrl(req: NextRequest, notice: SuperLoginNotice): string {
  return `${ontapPublicOrigin(req)}/super-login?sso=${notice}`;
}

export function noStoreRedirect(url: string): NextResponse {
  const response = NextResponse.redirect(url, 303);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export function clearSsoStateCookie(response: NextResponse): NextResponse {
  response.cookies.set(SSO_STATE_COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: SSO_STATE_COOKIE_PATH,
    maxAge: 0,
  });
  return response;
}
