import { NextRequest, NextResponse } from "next/server";

import {
  getClientIp,
  getUserAgent,
  logAuditEvent,
  resolveRequestSession,
} from "@/server/lib/auth";
import { checkDistributedRateLimit } from "@/server/lib/rate-limit-distributed";
import {
  createPetTagsPortalSwitchToken,
  getPetTagsAppUrl,
  isPortalSwitchConfigured,
} from "@/server/lib/portal-sso";
import {
  evaluateSuperadminEligibility,
  loadSuperadminAccountById,
} from "@/server/lib/cross-portal-superadmin";
import {
  isTrustedReferrer,
  isValidSsoState,
  safeOrigin,
} from "@/server/lib/cross-portal-sso-policy";
import { noStoreRedirect } from "@/server/lib/cross-portal-redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/cross-portal/authorize?state=...
 * Silent sign-in for SmartPet: if this browser holds a valid OnTap superadmin
 * session, hand SmartPet a 90-second single-use SSO token bound to SmartPet's
 * browser state. Otherwise send the browser back to the SmartPet login form.
 * The redirect target is fixed to the configured SmartPet origin.
 */
export async function GET(req: NextRequest) {
  if (!isPortalSwitchConfigured()) {
    return NextResponse.json(
      { success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Portal SSO is not configured." } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const petTagsBase = getPetTagsAppUrl();
  const petTagsOrigin = safeOrigin(petTagsBase);
  const backToLogin = (notice: "none" | "failed") =>
    noStoreRedirect(`${petTagsBase}/admin/login?sso=${notice}`);

  const state = req.nextUrl.searchParams.get("state");
  if (!isValidSsoState(state)) {
    return backToLogin("failed");
  }

  if (!isTrustedReferrer(req.headers.get("referer"), petTagsOrigin)) {
    return backToLogin("none");
  }

  const ip = getClientIp(req);
  const limit = await checkDistributedRateLimit(`xp-authorize:${ip}`, "sensitive");
  if (!limit.allowed) {
    return backToLogin("failed");
  }

  try {
    const auth = await resolveRequestSession(req, { tryRefresh: true });
    if (!auth.session) {
      return backToLogin("none");
    }

    const account = await loadSuperadminAccountById(auth.session.userId);
    const eligibility = evaluateSuperadminEligibility(account);
    if (!eligibility.ok || !account) {
      return backToLogin("none");
    }

    const { redirectUrl } = createPetTagsPortalSwitchToken({
      email: account.email,
      fullName: account.fullName,
      state,
    });

    await logAuditEvent("CROSS_PORTAL_SSO_AUTHORIZE", account.userId, ip, getUserAgent(req), {
      target: "smartpet",
      sessionId: auth.session.sessionId,
    });

    return noStoreRedirect(redirectUrl);
  } catch (error) {
    console.error("[cross-portal][authorize] failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return backToLogin("failed");
  }
}
