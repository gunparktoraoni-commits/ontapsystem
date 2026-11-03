import { NextRequest } from "next/server";

import {
  createSession,
  getClientIp,
  getUserAgent,
  logAuditEvent,
} from "@/server/lib/auth";
import { extractGeoMetadata } from "@/server/lib/analytics";
import { checkDistributedRateLimit } from "@/server/lib/rate-limit-distributed";
import {
  consumeSessionHandoffTicket,
  evaluateSuperadminEligibility,
  loadSuperadminAccountById,
} from "@/server/lib/cross-portal-superadmin";
import {
  SSO_STATE_COOKIE_NAME,
  decodeStateCookie,
  isValidHandoffTicket,
} from "@/server/lib/cross-portal-sso-policy";
import {
  clearSsoStateCookie,
  noStoreRedirect,
  ontapPublicOrigin,
  superLoginUrl,
  type SuperLoginNotice,
} from "@/server/lib/cross-portal-redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/cross-portal/callback?ticket=...
 * Completes silent sign-in from SmartPet: consumes the single-use ticket
 * (which must match this browser's state cookie) and opens a normal OnTap
 * session with httpOnly cookies. The state cookie is always cleared.
 */
export async function GET(req: NextRequest) {
  const finish = (url: string) => clearSsoStateCookie(noStoreRedirect(url));
  const fail = (notice: SuperLoginNotice) => finish(superLoginUrl(req, notice));

  const stateCookie = decodeStateCookie(req.cookies.get(SSO_STATE_COOKIE_NAME)?.value);
  const ticket = req.nextUrl.searchParams.get("ticket");

  if (req.nextUrl.searchParams.has("error")) {
    return fail("none");
  }
  if (!stateCookie || !isValidHandoffTicket(ticket)) {
    return fail("failed");
  }

  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const limit = await checkDistributedRateLimit(`xp-callback:${ip}`, "sensitive");
    if (!limit.allowed) {
      return fail("failed");
    }

    const userId = await consumeSessionHandoffTicket({ ticket, state: stateCookie.state });
    if (!userId) {
      await logAuditEvent("CROSS_PORTAL_SSO_TICKET_REJECTED", undefined, ip, userAgent, {});
      return fail("failed");
    }

    const account = await loadSuperadminAccountById(userId);
    const eligibility = evaluateSuperadminEligibility(account);
    if (!eligibility.ok || !account) {
      await logAuditEvent("CROSS_PORTAL_SSO_LOGIN_REJECTED", userId, ip, userAgent, {
        reason: eligibility.ok ? "NOT_FOUND" : eligibility.reason,
      });
      return fail("failed");
    }

    const geo = extractGeoMetadata(req);
    const location = geo.city && geo.country ? `${geo.city}, ${geo.country}` : geo.country ?? null;
    const created = await createSession(
      { userId: account.userId, email: account.email, role: account.role },
      false,
      ip,
      userAgent,
      { location },
    );

    await logAuditEvent("CROSS_PORTAL_SSO_LOGIN", account.userId, ip, userAgent, {
      source: "smartpet",
      sessionId: created.session.sessionId,
    });

    return finish(`${ontapPublicOrigin(req)}${stateCookie.redirect}`);
  } catch (error) {
    console.error("[cross-portal][callback] failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return fail("failed");
  }
}
