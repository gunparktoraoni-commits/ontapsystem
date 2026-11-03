import { NextRequest } from "next/server";

import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { checkDistributedRateLimit } from "@/server/lib/rate-limit-distributed";
import { getPetTagsAppUrl, isPortalSwitchConfigured } from "@/server/lib/portal-sso";
import { isCrossPortalServiceConfigured } from "@/server/lib/cross-portal-service-auth";
import {
  SSO_STATE_COOKIE_NAME,
  SSO_STATE_COOKIE_PATH,
  SSO_STATE_TTL_SECONDS,
  encodeStateCookie,
  generateRandomToken,
  isCrossPortalSuperadminRole,
  sanitizeSuperadminRedirect,
} from "@/server/lib/cross-portal-sso-policy";
import {
  noStoreRedirect,
  ontapPublicOrigin,
  superLoginUrl,
} from "@/server/lib/cross-portal-redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/cross-portal/start?redirect=/superadmin/...
 * Begins silent sign-in from a SmartPet session. A random state is stored in
 * an httpOnly cookie scoped to /api/auth/cross-portal and sent to SmartPet;
 * the handoff ticket SmartPet returns is only honoured by the browser that
 * holds this exact cookie.
 */
export async function GET(req: NextRequest) {
  const redirect = sanitizeSuperadminRedirect(req.nextUrl.searchParams.get("redirect"));

  if (!isPortalSwitchConfigured() || !isCrossPortalServiceConfigured()) {
    return noStoreRedirect(superLoginUrl(req, "unavailable"));
  }

  try {
    const existing = await resolveRequestSession(req, { tryRefresh: false });
    if (existing.session && isCrossPortalSuperadminRole(existing.session.role)) {
      return noStoreRedirect(`${ontapPublicOrigin(req)}${redirect}`);
    }

    const limit = await checkDistributedRateLimit(`xp-start:${getClientIp(req)}`, "sensitive");
    if (!limit.allowed) {
      return noStoreRedirect(superLoginUrl(req, "failed"));
    }

    const state = generateRandomToken(32);
    const response = noStoreRedirect(
      `${getPetTagsAppUrl()}/auth/sso/ontap?state=${encodeURIComponent(state)}`,
    );
    response.cookies.set(SSO_STATE_COOKIE_NAME, encodeStateCookie(state, redirect), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: SSO_STATE_COOKIE_PATH,
      maxAge: SSO_STATE_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    console.error("[cross-portal][start] failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return noStoreRedirect(superLoginUrl(req, "failed"));
  }
}
