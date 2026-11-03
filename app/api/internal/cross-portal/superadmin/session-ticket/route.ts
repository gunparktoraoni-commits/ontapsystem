import { NextRequest } from "next/server";
import { z } from "zod";

import { logAuditEvent } from "@/server/lib/auth";
import { checkDistributedRateLimit } from "@/server/lib/rate-limit-distributed";
import {
  internalError,
  internalSuccess,
  readSignedInternalJson,
} from "@/server/lib/cross-portal-internal-http";
import {
  evaluateSuperadminEligibility,
  hasActiveSuperadminSession,
  issueSessionHandoffTicket,
  loadSuperadminAccountByEmail,
} from "@/server/lib/cross-portal-superadmin";

export const runtime = "nodejs";

const SESSION_TICKET_PATH = "/api/internal/cross-portal/superadmin/session-ticket";

const sessionTicketSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    state_hash: z.string().regex(/^[a-f0-9]{64}$/),
    ip: z.string().trim().max(64).optional(),
  })
  .strict();

/**
 * POST /api/internal/cross-portal/superadmin/session-ticket
 * Mints a 60-second, single-use ticket that lets the superadmin's browser
 * open an OnTap session. The ticket is bound to the browser's SSO state
 * cookie (by hash) and is only issued while the superadmin still has a live
 * OnTap session, so a logged-out superadmin cannot be silently signed back in.
 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  const signed = await readSignedInternalJson(req, SESSION_TICKET_PATH, requestId);
  if (!signed.ok) return signed.response;

  const parsed = sessionTicketSchema.safeParse(signed.json);
  if (!parsed.success) {
    return internalError("INVALID_REQUEST_PAYLOAD", "Invalid session ticket payload.", 400, requestId);
  }

  const { email, state_hash: stateHash } = parsed.data;
  const ipAddress = parsed.data.ip || "unknown";

  try {
    const limit = await checkDistributedRateLimit(`xp-superadmin-ticket:${email}`, "sensitive");
    if (!limit.allowed) {
      return internalError(
        "RATE_LIMIT_EXCEEDED",
        "Too many sign-in handoffs. Please try again later.",
        429,
        requestId,
        { "Retry-After": String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))) },
      );
    }

    const account = await loadSuperadminAccountByEmail(email);
    const eligibility = evaluateSuperadminEligibility(account);
    if (!eligibility.ok || !account) {
      return internalError("SESSION_INACTIVE", "Superadmin session is not active.", 403, requestId);
    }

    if (!(await hasActiveSuperadminSession(account.userId))) {
      return internalError("SESSION_INACTIVE", "Superadmin session is not active.", 403, requestId);
    }

    const { ticket, expiresAt } = await issueSessionHandoffTicket({
      userId: account.userId,
      stateHash,
      ipAddress,
    });

    await logAuditEvent("CROSS_PORTAL_SUPERADMIN_TICKET_ISSUED", account.userId, ipAddress, "SmartPet", {
      requestId,
      caller: "smartpet-admin",
    });

    return internalSuccess({ ticket, expires_at: expiresAt.toISOString() }, requestId, startedAt);
  } catch (error) {
    console.error("[cross-portal][session-ticket] failed", {
      requestId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return internalError("INTERNAL_ERROR", "Unable to issue a session handoff.", 500, requestId);
  }
}
