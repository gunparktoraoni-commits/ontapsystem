import { NextRequest } from "next/server";
import { z } from "zod";

import { logAuditEvent, verifyPassword } from "@/server/lib/auth";
import { checkDistributedRateLimit } from "@/server/lib/rate-limit-distributed";
import { recordFailedAttempt } from "@/server/lib/rate-limit";
import {
  internalError,
  internalSuccess,
  readSignedInternalJson,
} from "@/server/lib/cross-portal-internal-http";
import {
  evaluateSuperadminEligibility,
  loadSuperadminAccountByEmail,
  neutralizeSessionTokens,
  revokeSessionById,
} from "@/server/lib/cross-portal-superadmin";
import { isCrossPortalSuperadminRole } from "@/server/lib/cross-portal-sso-policy";
import { AdminAuthService } from "@/lib/services/auth.service";
import { SuperadminSettingsService } from "@/lib/services/superadmin-settings.service";
import { AppError } from "@/lib/errors/types";
import { AuthErrorCode, extractAuthErrorCode } from "@/lib/errors/auth-errors";

export const runtime = "nodejs";

const AUTHENTICATE_PATH = "/api/internal/cross-portal/superadmin/authenticate";
const TIMING_EQUALIZER_HASH = "$2a$12$LJ3m4ys3Lz0Yc3LRXBBXHO0000000000000000000000000000000";

const authenticateSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(1).max(256),
    ip: z.string().trim().max(64).optional(),
    user_agent: z.string().trim().max(400).optional(),
  })
  .strict();

const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password.";

function mapLoginError(error: unknown, requestId: string) {
  if (!(error instanceof AppError)) {
    return internalError("INTERNAL_ERROR", "Unable to sign in right now.", 500, requestId);
  }

  const code = extractAuthErrorCode(error);
  switch (code) {
    case AuthErrorCode.INVALID_CREDENTIALS:
    case AuthErrorCode.ADMIN_ROLE_REQUIRED:
      return internalError("INVALID_CREDENTIALS", INVALID_CREDENTIALS_MESSAGE, 401, requestId);
    case AuthErrorCode.LOCKOUT_ACTIVE:
    case AuthErrorCode.ACCOUNT_LOCKED: {
      const retryAfter = Number((error.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds);
      return internalError(
        "ACCOUNT_LOCKED",
        "Account temporarily locked due to too many failed attempts. Please try again later.",
        429,
        requestId,
        Number.isFinite(retryAfter) && retryAfter > 0 ? { "Retry-After": String(Math.ceil(retryAfter)) } : undefined,
      );
    }
    case AuthErrorCode.ACCOUNT_DEACTIVATED:
      return internalError("ACCOUNT_DEACTIVATED", "This account is deactivated.", 403, requestId);
    case AuthErrorCode.EMAIL_NOT_VERIFIED:
      return internalError("EMAIL_NOT_VERIFIED", "Verify your OnTap email before signing in.", 403, requestId);
    default:
      return internalError("INTERNAL_ERROR", "Unable to sign in right now.", 500, requestId);
  }
}

function ineligibleResponse(reason: string, requestId: string) {
  switch (reason) {
    case "DEACTIVATED":
      return internalError("ACCOUNT_DEACTIVATED", "This account is deactivated.", 403, requestId);
    case "RESTRICTED":
      return internalError("ACCOUNT_RESTRICTED", "This account is restricted.", 403, requestId);
    case "EMAIL_NOT_VERIFIED":
      return internalError("EMAIL_NOT_VERIFIED", "Verify your OnTap email before signing in.", 403, requestId);
    case "PASSWORD_CHANGE_REQUIRED":
      return internalError(
        "PASSWORD_CHANGE_REQUIRED",
        "Sign in on the OnTap portal first to set a new password.",
        403,
        requestId,
      );
    case "REVERIFICATION_REQUIRED":
      return internalError(
        "REVERIFICATION_REQUIRED",
        "Sign in on the OnTap portal to complete account reverification.",
        403,
        requestId,
      );
    default:
      return internalError("INVALID_CREDENTIALS", INVALID_CREDENTIALS_MESSAGE, 401, requestId);
  }
}

/**
 * POST /api/internal/cross-portal/superadmin/authenticate
 * SmartPet delegates superadmin password verification to OnTap (source of
 * truth). Reuses the OnTap admin login pipeline: lockout, failed-attempt
 * tracking, audit, reverification stamp and login tracking.
 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  const signed = await readSignedInternalJson(req, AUTHENTICATE_PATH, requestId);
  if (!signed.ok) return signed.response;

  const parsed = authenticateSchema.safeParse(signed.json);
  if (!parsed.success) {
    return internalError("INVALID_REQUEST_PAYLOAD", "Invalid authentication payload.", 400, requestId);
  }

  const { email, password } = parsed.data;
  const ipAddress = parsed.data.ip || "unknown";
  const userAgent = `SmartPet/${(parsed.data.user_agent || "unknown").slice(0, 380)}`;

  try {
    const [emailLimit, ipLimit] = await Promise.all([
      checkDistributedRateLimit(`xp-superadmin-login:email:${email}`, "login"),
      checkDistributedRateLimit(`xp-superadmin-login:ip:${ipAddress}`, "sensitive"),
    ]);
    if (!emailLimit.allowed || !ipLimit.allowed) {
      const retryAfterMs = Math.max(emailLimit.retryAfterMs, ipLimit.retryAfterMs, 1000);
      return internalError(
        "RATE_LIMIT_EXCEEDED",
        "Too many sign-in attempts. Please try again later.",
        429,
        requestId,
        { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
      );
    }

    const preflight = await loadSuperadminAccountByEmail(email);
    if (preflight && !isCrossPortalSuperadminRole(preflight.role)) {
      // Same cost and response as a wrong password so roles cannot be enumerated.
      await verifyPassword(password, TIMING_EQUALIZER_HASH);
      await Promise.all([
        recordFailedAttempt(email, ipAddress),
        logAuditEvent("CROSS_PORTAL_SUPERADMIN_LOGIN_ROLE_BLOCKED", preflight.userId, ipAddress, userAgent, {
          requestId,
          caller: "smartpet-admin",
        }),
      ]);
      return internalError("INVALID_CREDENTIALS", INVALID_CREDENTIALS_MESSAGE, 401, requestId);
    }

    let login: Awaited<ReturnType<AdminAuthService["login"]>>;
    try {
      login = await new AdminAuthService(requestId).login(
        { email, password, rememberMe: false },
        { ipAddress, userAgent, location: null },
      );
    } catch (error) {
      return mapLoginError(error, requestId);
    }

    const sessionId = login.session.sessionId;
    await neutralizeSessionTokens(sessionId);

    if (login.user.requiresPasswordChange) {
      await revokeSessionById(sessionId);
      return ineligibleResponse("PASSWORD_CHANGE_REQUIRED", requestId);
    }

    const account = await loadSuperadminAccountByEmail(email);
    const eligibility = evaluateSuperadminEligibility(account);
    if (!eligibility.ok || !account) {
      await revokeSessionById(sessionId);
      await logAuditEvent(
        "CROSS_PORTAL_SUPERADMIN_LOGIN_REJECTED",
        account?.userId,
        ipAddress,
        userAgent,
        { requestId, reason: eligibility.ok ? "NOT_FOUND" : eligibility.reason },
      );
      return ineligibleResponse(eligibility.ok ? "NOT_FOUND" : eligibility.reason, requestId);
    }

    const profile = await new SuperadminSettingsService(requestId).getProfile(account.userId);

    await logAuditEvent("CROSS_PORTAL_SUPERADMIN_LOGIN", account.userId, ipAddress, userAgent, {
      requestId,
      caller: "smartpet-admin",
      sessionId,
    });

    return internalSuccess(
      {
        profile,
        session: { expires_at: login.session.expiresAt },
      },
      requestId,
      startedAt,
    );
  } catch (error) {
    console.error("[cross-portal][authenticate] failed", { requestId, error: error instanceof Error ? error.message : "unknown" });
    return internalError("INTERNAL_ERROR", "Unable to sign in right now.", 500, requestId);
  }
}
