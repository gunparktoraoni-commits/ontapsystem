import { NextRequest } from "next/server";
import { z } from "zod";

import {
  internalError,
  internalSuccess,
  readSignedInternalJson,
} from "@/server/lib/cross-portal-internal-http";
import {
  evaluateSuperadminEligibility,
  hasActiveSuperadminSession,
  loadSuperadminAccountByEmail,
} from "@/server/lib/cross-portal-superadmin";

export const runtime = "nodejs";

const SESSION_STATUS_PATH = "/api/internal/cross-portal/superadmin/session-status";

const sessionStatusSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
  })
  .strict();

/**
 * POST /api/internal/cross-portal/superadmin/session-status
 * SmartPet asks whether a superadmin is still signed in on OnTap and still
 * allowed in. Logging out, deactivation, restriction or demotion on OnTap
 * therefore ends the SmartPet session as well.
 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  const signed = await readSignedInternalJson(req, SESSION_STATUS_PATH, requestId);
  if (!signed.ok) return signed.response;

  const parsed = sessionStatusSchema.safeParse(signed.json);
  if (!parsed.success) {
    return internalError("INVALID_REQUEST_PAYLOAD", "Invalid session status payload.", 400, requestId);
  }

  try {
    const account = await loadSuperadminAccountByEmail(parsed.data.email);
    const eligibility = evaluateSuperadminEligibility(account);
    if (!eligibility.ok || !account) {
      return internalSuccess(
        { active: false, reason: eligibility.ok ? "NOT_FOUND" : eligibility.reason },
        requestId,
        startedAt,
      );
    }

    const active = await hasActiveSuperadminSession(account.userId);
    return internalSuccess(
      active ? { active: true } : { active: false, reason: "NO_ACTIVE_SESSION" },
      requestId,
      startedAt,
    );
  } catch (error) {
    console.error("[cross-portal][session-status] failed", {
      requestId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return internalError("INTERNAL_ERROR", "Unable to check session status.", 500, requestId);
  }
}
