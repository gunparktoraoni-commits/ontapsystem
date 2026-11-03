// ──────────────────────────────────────────────────────────────
// POST /api/auth/login — Secure Login Endpoint
// ──────────────────────────────────────────────────────────────
// Security layers (in order):
// 1. IP rate limiting (in-memory sliding window)
// 2. Account lockout check (DB-backed progressive lockout)
// 3. Input validation & sanitization
// 4. Email normalization
// 5. Credential lookup (constant-time password compare via bcrypt)
// 6. Account status check (deactivated flag)
// 7. Failed attempt recording (feeds lockout policy)
// 8. Session creation with remember-me support
// 9. Audit logging (success & failure)
//
// Information Leakage Prevention:
// - "Invalid email or password" for ALL auth failures
// - No indication of whether the email exists
// - Timing-safe: bcrypt.compare runs even if no user found (see below)
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import {
  verifyPassword,
  isValidEmail,
  createSession,
  createEmailOtp,
  createReverificationStateToken,
  isReverificationRequired,
  revokeAllSessions,
  logAuditEvent,
  getClientIp,
  getUserAgent,
  getReauthStateCookieOptions,
} from "@/server/lib/auth";
import { validateLoginInput } from "@/server/lib/validators";
import {
  checkRateLimit,
  checkAccountLockout,
  recordFailedAttempt,
  recordSuccessfulLogin,
} from "@/server/lib/rate-limit";
import { checkDistributedRateLimit } from "@/server/lib/rate-limit-distributed";
import { withPerformanceTracking } from "@/middleware/performance";
import { VerificationService } from "@/lib/services/verificationService";
import { EmailService } from "@/lib/services/emailService";
import { SuperadminSettingsService } from "@/lib/services/superadmin-settings.service";
import { ensureAliasLockStarted } from "@/lib/bizcard/url-alias-utils";
import {
  SubscriptionAccessService,
  buildAccessRedirectUrl,
} from "@/lib/services/subscription-access.service";
import { extractGeoMetadata } from "@/server/lib/analytics";
import { getGeolocationFromIP, getLocationString, getCoordinates } from "@/lib/services/geolocation.service";
import { DeviceService } from "@/lib/services/device.service";
import { isValidFingerprint } from "@/lib/utils/device-fingerprint";
import { ensureSuperadminBizcardsPremium } from "@/lib/services/superadmin-premium.service";
import { isForcedPlaceholderEmail } from "@/lib/auth/placeholder-email";

function serialize(obj: unknown): unknown {
  return JSON.parse(
    JSON.stringify(obj, (_, value) => (typeof value === "bigint" ? value.toString() : value))
  );
}

// Dummy hash for timing attack prevention — run bcrypt.compare even when
// no account exists so the response time is identical either way.
// This prevents attackers from detecting valid emails via response timing.
const DUMMY_HASH = "$2a$12$LJ3m4ys3Lz0Yc3LRXBBXHO0000000000000000000000000000000";

export async function POST(request: NextRequest) {
  return withPerformanceTracking(request, async () => {
    const ip = getClientIp(request);
    const ua = getUserAgent(request);
    const geo = extractGeoMetadata(request);
    const location = geo.city && geo.country ? `${geo.city}, ${geo.country}` : geo.country ?? null;
    
    // Get enhanced geolocation data from IP service
    const ipGeoData = await getGeolocationFromIP(ip);
    const enhancedLocation = ipGeoData ? getLocationString(ipGeoData) : location;
    const coords = ipGeoData ? getCoordinates(ipGeoData) : { latitude: geo.latitude, longitude: geo.longitude };

    try {
    // ── Layer 0: Distributed Rate Limiting ───────────
    // Primary global guard across serverless instances.
    const globalRate = await checkDistributedRateLimit(ip, "login");
    if (!globalRate.allowed) {
      await logAuditEvent("LOGIN_RATE_LIMITED_GLOBAL", undefined, ip, ua);
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(globalRate.retryAfterMs / 1000)),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    // ── Layer 1: IP Rate Limiting ──────────────────
    const rateCheck = checkRateLimit("login", ip);
    if (!rateCheck.allowed) {
      const retryAfterSec = Math.ceil(rateCheck.retryAfterMs / 1000);
      await logAuditEvent("LOGIN_RATE_LIMITED", undefined, ip, ua);

      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfterSec),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    // ── Layer 2: Parse & Validate Input ────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      );
    }

    const validation = validateLoginInput(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.errors[0] },
        { status: 400 }
      );
    }

    const { email, password, rememberMe } = validation.data;

    if (!isValidEmail(email)) {
      return NextResponse.json(
        { error: "Please provide a valid email address." },
        { status: 400 }
      );
    }

    // ── Layers 3+4: Lockout Check & Credential Lookup (parallel) ──
    // Both are independent DB reads — run concurrently to save one
    // full DB round-trip on every login request.
    const [lockoutCheck, credential] = await Promise.all([
      checkAccountLockout(email),
      prisma.credential.findFirst({
        where: { user: { email: email } },
        select: {
          password_hash: true,
          email_verified: true,
          must_change_password: true,
          user: {
            select: {
              user_id: true,
              email: true,
              first_name: true,
              last_name: true,
              role: true,
              custom_uri: true,
              deactivated_flag: true,
              deleted_at: true,
              is_restricted: true,
              restricted_until: true,
              created_at: true,
              last_reverification_at: true,
              webauthnCredentials: {
                select: { credential_id: true },
              },
            },
          },
        },
      }),
    ]);

    if (lockoutCheck.locked) {
      const retryAfterSec = Math.ceil(lockoutCheck.retryAfterMs / 1000);
      await logAuditEvent("LOGIN_ACCOUNT_LOCKED", undefined, ip, ua, { email });

      return NextResponse.json(
        {
          error: "Account temporarily locked due to too many failed attempts. Please try again later.",
        },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfterSec) },
        }
      );
    }

    // TIMING ATTACK PREVENTION: Always run bcrypt.compare, even for
    // non-existent accounts. This ensures the endpoint takes the same
    // amount of time regardless of whether the email exists.
    const hashToCompare = credential?.password_hash ?? DUMMY_HASH;
    const isValid = await verifyPassword(password, hashToCompare);

    if (!credential || !isValid) {
      // Record failed attempt and audit log concurrently
      await Promise.all([
        recordFailedAttempt(email, ip),
        logAuditEvent("LOGIN_FAILED", undefined, ip, ua, { email }),
      ]);

      // Generic error — no information leakage about which field is wrong
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    const { user } = credential;

    // ── Layer 5: Account Status Check ──────────────
    if (user.deleted_at) {
      await logAuditEvent("LOGIN_DELETED_ACCOUNT", Number(user.user_id), ip, ua);

      return NextResponse.json(
        { error: "This account is no longer available." },
        { status: 403 }
      );
    }

    if (user.deactivated_flag) {
      await logAuditEvent("LOGIN_DEACTIVATED_ACCOUNT", Number(user.user_id), ip, ua);

      return NextResponse.json(
        { error: "This account has been deactivated." },
        { status: 403 }
      );
    }

    const restricted =
      Boolean(user.is_restricted) &&
      (user.restricted_until == null || user.restricted_until.getTime() > Date.now());
    if (restricted) {
      await logAuditEvent("LOGIN_RESTRICTED_ACCOUNT", Number(user.user_id), ip, ua);

      return NextResponse.json(
        { error: "This account has been restricted from signing in. Contact support for help." },
        { status: 403 }
      );
    }

    // ── Layer 6: Email Verification Check ──────────
    // Block login if the user has not verified their email address.
    // Placeholder PCO accounts (pco01@gmail.com, etc.) are exempt here so they
    // can complete a forced email change + OTP on the login page instead.
    const requiresEmailChange = isForcedPlaceholderEmail(user.email);
    if (!credential.email_verified && !requiresEmailChange) {
      await logAuditEvent("LOGIN_UNVERIFIED_EMAIL", Number(user.user_id), ip, ua);

      const verificationService = VerificationService.getInstance();
      const emailService = EmailService.getInstance();
      const verification = await verificationService.createVerification(user.email);

      if (!("error" in verification)) {
        const sent = await emailService.sendVerificationEmail({
          email: user.email,
          code: verification.code,
          expiresAt: verification.expiresAt,
        });

        if (!sent.success) {
          await logAuditEvent("EMAIL_SEND_FAILED", Number(user.user_id), ip, ua, {
            error: sent.error ?? "Unknown error",
            context: "login-unverified",
          });
        }
      }

      return NextResponse.json(
        {
          error: "Please verify your email address before logging in. A new verification code has been sent.",
          code: "EMAIL_NOT_VERIFIED",
          userId: Number(user.user_id),
        },
        { status: 403 }
      );
    }

    // PCO placeholder accounts must change email before normal reverification.
    const reverificationRequired =
      !requiresEmailChange &&
      isReverificationRequired({
        created_at: user.created_at,
        last_reverification_at: user.last_reverification_at,
      });

    if (reverificationRequired) {
      const hasWebAuthnCredential = (user.webauthnCredentials?.length ?? 0) > 0;
      const otp = await createEmailOtp(Number(user.user_id), "otp_reauth");
      const emailService = EmailService.getInstance();
      const otpSent = await emailService.sendVerificationEmail({
        email: user.email,
        code: otp,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      await Promise.all([
        revokeAllSessions(Number(user.user_id)),
        logAuditEvent("LOGIN_REVERIFICATION_REQUIRED", Number(user.user_id), ip, ua, { email }),
      ]);

      const reverifyState = createReverificationStateToken({
        userId: Number(user.user_id),
        email: user.email,
        purpose: "otp_reauth",
      });

      const response = NextResponse.json(
        {
          error: "Verification required before access can be restored.",
          code: "REVERIFICATION_REQUIRED",
          userId: Number(user.user_id),
          verificationMethods: {
            webauthn: hasWebAuthnCredential,
            otp: true,
          },
          reverification: {
            required: true,
            expiresAt: reverifyState.expiresAt.toISOString(),
            otpSent: otpSent.success,
          },
        },
        { status: 403 }
      );

      response.cookies.set("reauth_state", reverifyState.token, getReauthStateCookieOptions(15 * 60));

      return response;
    }

    // ── Layer 6: Create Session ────────────────────
    // All post-auth writes are independent — run concurrently
    const [, createdSession] = await Promise.all([
      recordSuccessfulLogin(email, ip),
      createSession(
        {
          userId: Number(user.user_id),
          email: user.email,
          role: user.role,
        },
        rememberMe,
        ip,
        ua,
        { location: enhancedLocation }
      ),
      logAuditEvent("LOGIN_SUCCESS", Number(user.user_id), ip, ua, { rememberMe }),
      // Update user record with geolocation data
      prisma.user.update({
        where: { user_id: user.user_id },
        data: {
          last_login_ip: ip,
          last_login_location: enhancedLocation,
          last_login_latitude: coords.latitude,
          last_login_longitude: coords.longitude,
          last_login_country: ipGeoData?.country || geo.country,
          last_login_city: ipGeoData?.city || geo.city,
          last_login_at: new Date()
        }
      })
    ]);

    // Stamp 90-day alias lock for migrated users who never received last_url_alias_changed_at.
    // Non-fatal: login must succeed even if this stamp fails.
    try {
      await ensureAliasLockStarted(user.user_id);
    } catch (aliasLockError) {
      console.error("[login] Failed to ensure alias lock:", aliasLockError);
    }

    // ── Link Device to User (if provided) ──────────
    const deviceId = body.deviceId || body.device_id || body.deviceFingerprint || body.device_fingerprint;
    if (deviceId && isValidFingerprint(deviceId)) {
      try {
        const deviceService = new DeviceService(`login:${Number(user.user_id)}`);
        await deviceService.linkDeviceToUser(deviceId as string, user.user_id);
      } catch (deviceError) {
        console.error("[login] Failed to link device:", deviceError);
        // Non-fatal: user is logged in successfully
      }
    }

    if (user.role.toLowerCase() === "super_admin") {
      const settingsService = new SuperadminSettingsService(`login:${Number(user.user_id)}`);
      settingsService
        .recordLogin({
          userId: Number(user.user_id),
          sessionId: String(createdSession.session.sessionId),
          userAgent: ua,
          ipAddress: ip,
          location: enhancedLocation,
          latitude: coords.latitude,
          longitude: coords.longitude,
        })
        .catch((error) => {
          console.error("Superadmin login tracking failed:", error);
        });

      ensureSuperadminBizcardsPremium(user.user_id).catch((error) => {
        console.error("Superadmin permanent premium sync failed:", error);
      });
    }

    const accessService = new SubscriptionAccessService(`login:${Number(user.user_id)}`);
    const accessStatus = await accessService.getUserAccessStatus(user.user_id);

    // ── Response ───────────────────────────────────
    // Only return non-sensitive user data
    const hasWebAuthnCredential = (user.webauthnCredentials?.length ?? 0) > 0;
    const response: Record<string, unknown> = {
      message: "Login successful.",
      user: {
        userId: Number(user.user_id),
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        customUri: user.custom_uri,
        requiresPasswordChange: credential.must_change_password === true,
        requiresEmailChange,
      },
      biometric: {
        hasCredential: hasWebAuthnCredential,
        available: true,
      },
    };

    response.accessStatus = accessStatus;

    // Add redirect info if the user has no active access.
    if (!accessStatus.hasAccess) {
      response.requiresUpgrade = true;
      response.requires_upgrade = true;
      const redirectTarget = buildAccessRedirectUrl(accessStatus.reason);
      response.redirectUrl = redirectTarget;
      response.redirect_url = redirectTarget;
      response.subscriptionStatus = accessStatus.reason;
    } else if (accessStatus.reason === "free_trial" && (accessStatus.daysRemaining ?? 0) <= 7) {
      response.trialWarning = true;
      response.trialDaysRemaining = accessStatus.daysRemaining;
    }

    return NextResponse.json(serialize(response), { status: 200 });
    } catch (error) {
      console.error("Login error:", error);
      await logAuditEvent("LOGIN_ERROR", undefined, ip, ua, {
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return NextResponse.json(
        { error: "Internal server error." },
        { status: 500 }
      );
    }
  });
}
