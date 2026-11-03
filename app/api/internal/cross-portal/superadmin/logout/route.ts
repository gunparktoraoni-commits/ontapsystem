import { NextRequest } from "next/server";
import { z } from "zod";

import { logAuditEvent } from "@/server/lib/auth";
import {
  internalError,
  internalSuccess,
  readSignedInternalJson,
} from "@/server/lib/cross-portal-internal-http";
import {
  loadSuperadminAccountByEmail,
  revokeAllSuperadminSessions,
} from "@/server/lib/cross-portal-superadmin";
import { isCrossPortalSuperadminRole } from "@/server/lib/cross-portal-sso-policy";

export const runtime = "nodejs";

const LOGOUT_PATH = "/api/internal/cross-portal/superadmin/logout";

const logoutSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    ip: z.string().trim().max(64).optional(),
  })
  .strict();

/**
 * POST /api/internal/cross-portal/superadmin/logout
 * Signing out of SmartPet signs the superadmin out of OnTap too (all OnTap
 * sessions are revoked), mirroring OnTap's own superadmin logout.
 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  const signed = await readSignedInternalJson(req, LOGOUT_PATH, requestId);
  if (!signed.ok) return signed.response;

  const parsed = logoutSchema.safeParse(signed.json);
  if (!parsed.success) {
    return internalError("INVALID_REQUEST_PAYLOAD", "Invalid logout payload.", 400, requestId);
  }

  try {
    const account = await loadSuperadminAccountByEmail(parsed.data.email);
    if (!account || !isCrossPortalSuperadminRole(account.role)) {
      return internalSuccess({ revoked: 0 }, requestId, startedAt);
    }

    const revoked = await revokeAllSuperadminSessions(account.userId);
    await logAuditEvent(
      "CROSS_PORTAL_SUPERADMIN_LOGOUT",
      account.userId,
      parsed.data.ip || undefined,
      "SmartPet",
      { requestId, caller: "smartpet-admin", revoked },
    );

    return internalSuccess({ revoked }, requestId, startedAt);
  } catch (error) {
    console.error("[cross-portal][logout] failed", {
      requestId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return internalError("INTERNAL_ERROR", "Unable to sign out of OnTap.", 500, requestId);
  }
}
