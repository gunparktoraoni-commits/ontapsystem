// ──────────────────────────────────────────────────────────────
// POST /api/auth/register — Secure Registration Endpoint
// ──────────────────────────────────────────────────────────────
// DEFERRED-CREATION FLOW (OTP-first architecture):
//
//   1. User submits registration form
//   2. Backend validates & hashes password
//   3. Backend stores a PendingRegistration row (NOT a real User row)
//   4. OTP is generated, stored in PendingRegistration, emailed to user
//   5. Frontend shows OTP input
//   6. POST /api/auth/verify-email verifies the OTP, creates the real User,
//      deletes the PendingRegistration row, and opens a session.
//
// WHY: Previously the User row was persisted before OTP verification.
// If the user abandoned the flow, their email remained permanently locked
// in the DB, causing "email already exists" on any retry attempt.
//
// With this approach:
//   - No User row is created until OTP is verified.
//   - A user can retry registration with the same email as many times as
//     needed (each attempt overwrites the PendingRegistration row).
//   - If the OTP expires and the user never verifies, no orphan exists.
//
// Security layers:
//   1. IP rate limiting (prevent mass registration abuse)
//   2. Input validation & sanitization
//   3. Email format validation
//   4. Password strength enforcement
//   5. Secure password hashing (bcrypt, cost 12) — hash stored in pending row
//   6. Role derived SERVER-SIDE from registrationType
//   7. OTP is HMAC-SHA-256 hashed in the pending row
//   8. Pending row has a 15-minute OTP expiry
//   9. Duplicate handling: upsert on email (fresh pending replaces stale one)
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import {
  hashPassword,
  validatePassword,
  isValidEmail,
  logAuditEvent,
  getClientIp,
  getUserAgent,
} from "@/server/lib/auth";
import { validateRegisterInput } from "@/server/lib/validators";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { checkDistributedRateLimit } from "@/server/lib/rate-limit-distributed";
import { generateCsrfToken, setCsrfCookie } from "@/lib/csrf";
import { withPerformanceTracking } from "@/middleware/performance";
import { VerificationService } from "@/lib/services/verificationService";
import { EmailService } from "@/lib/services/emailService";
import { extractGeoMetadata } from "@/server/lib/analytics";
import { getGeolocationFromIP, getLocationString, getCoordinates } from "@/lib/services/geolocation.service";
import { isValidFingerprint } from "@/lib/utils/device-fingerprint";
import { resolveReferrerFromCode } from "@/server/lib/growth-referral";

// OTP expiry for pending registrations (15 minutes)
const PENDING_OTP_EXPIRY_MINUTES = 15;
const AFFILIATE_REF_COOKIE = "__affiliate_ref";

export async function POST(request: NextRequest) {
  return withPerformanceTracking(request, async () => {
    const ip = getClientIp(request);
    const ua = getUserAgent(request);
    const geo = extractGeoMetadata(request);

    // Get enhanced geolocation data from IP service
    const ipGeoData = await getGeolocationFromIP(ip);
    const enhancedLocation = ipGeoData
      ? getLocationString(ipGeoData)
      : geo.city && geo.country
        ? `${geo.city}, ${geo.country}`
        : geo.country ?? null;
    const coords = ipGeoData
      ? getCoordinates(ipGeoData)
      : { latitude: geo.latitude, longitude: geo.longitude };

    try {
      // ── Global Distributed Rate Limiting ───────────
      const globalRate = await checkDistributedRateLimit(ip, "sensitive");
      if (!globalRate.allowed) {
        return NextResponse.json(
          { error: "Too many registration attempts. Please try again later." },
          {
            status: 429,
            headers: { "Retry-After": String(Math.ceil(globalRate.retryAfterMs / 1000)) },
          }
        );
      }

      // ── Rate Limiting ──────────────────────────────
      const rateCheck = checkRateLimit("register", ip);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: "Too many registration attempts. Please try again later." },
          {
            status: 429,
            headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
          }
        );
      }

      // ── Parse & Validate Input ─────────────────────
      let body: Record<string, unknown>;
      try {
        body = await request.json();
      } catch {
        return NextResponse.json(
          { error: "Invalid request body." },
          { status: 400 }
        );
      }

      const validation = validateRegisterInput(body);
      if (!validation.valid) {
        return NextResponse.json(
          { error: validation.errors.join(" ") },
          { status: 400 }
        );
      }

      const {
        registrationType,
        email,
        password,
        confirmPassword,
        firstName,
        lastName,
        middleName,
        contact,
        companyName,
        promotionalEmailOptIn,
      } = validation.data;

      if (!isValidEmail(email)) {
        return NextResponse.json(
          { error: "Please provide a valid email address." },
          { status: 400 }
        );
      }

      if (password !== confirmPassword) {
        return NextResponse.json(
          { error: "Passwords do not match." },
          { status: 400 }
        );
      }

      const passwordValidation = validatePassword(password);
      if (!passwordValidation.valid) {
        return NextResponse.json(
          {
            error: "Password does not meet requirements.",
            details: passwordValidation.errors,
          },
          { status: 400 }
        );
      }

      // ── Duplicate Email Check (real verified users only) ──
      // We only block registration if a VERIFIED user account exists.
      // An unverified User row should never exist under the new flow,
      // but we guard against legacy data with this check.
      const existingUser = await prisma.user.findUnique({
        where: { email },
        select: { credentials: { select: { email_verified: true } } },
      });
      if (existingUser) {
        // If email is already verified → definitive duplicate
        // If somehow unverified (legacy) → still block and tell user to verify
        const isVerified = existingUser.credentials?.email_verified ?? false;
        if (isVerified) {
          return NextResponse.json(
            { error: "An account with this email already exists." },
            { status: 409 }
          );
        }
        // Legacy unverified user: treat as if they need to re-register
        // by deleting the orphaned row so PendingRegistration can take over.
        // This handles any data created before this fix was deployed.
        try {
          await prisma.user.delete({ where: { email } });
          await logAuditEvent("REGISTER_LEGACY_UNVERIFIED_DELETED", undefined, ip, ua, {
            email,
            context: "register",
          });
        } catch (cleanupErr) {
          // If delete fails (e.g. FK constraints), block as duplicate.
          console.error("[register] Failed to clean up legacy unverified user:", cleanupErr);
          return NextResponse.json(
            {
              error:
                "An account with this email is pending verification. Please verify your email or contact support.",
            },
            { status: 409 }
          );
        }
      }

      // ── Hash password before storing in pending row ─
      const hashedPassword = await hashPassword(password);

      // ── Generate OTP ───────────────────────────────
      const verificationService = VerificationService.getInstance();
      const rawCode = verificationService.generateCode();
      const otpHash = verificationService.hashCode(rawCode);
      const otpExpiresAt = new Date(
        Date.now() + PENDING_OTP_EXPIRY_MINUTES * 60 * 1000
      );

      // ── Optional device fingerprint ────────────────
      const rawDeviceId =
        body.deviceId || body.device_id || body.deviceFingerprint || body.device_fingerprint;
      const deviceId =
        rawDeviceId && isValidFingerprint(rawDeviceId) ? String(rawDeviceId) : null;

      // ── Growth referral attribution (invite / cookie) ──
      // Signup ?ref= is BizCard serial — do not use it here.
      const rawReferralCode =
        body.referral_code ??
        body.referralCode ??
        body.invite ??
        request.cookies.get(AFFILIATE_REF_COOKIE)?.value ??
        null;
      const referrer = await resolveReferrerFromCode(
        rawReferralCode != null ? String(rawReferralCode) : null,
      );
      const referralCode = referrer?.affiliate_code ?? null;

      // ── Upsert PendingRegistration ─────────────────
      // Using upsert on email so re-attempts (same email) simply refresh
      // the OTP and registration data instead of returning a duplicate error.
      await prisma.pendingRegistration.upsert({
        where: { email },
        create: {
          email,
          password_hash: hashedPassword,
          first_name: firstName,
          last_name: lastName,
          middle_name: middleName ?? null,
          contact: contact ?? null,
          registration_type: registrationType,
          company_name: companyName ?? null,
          promotional_opt_in: promotionalEmailOptIn,
          registration_ip: ip ?? null,
          registration_location: enhancedLocation ?? null,
          registration_latitude: coords.latitude ?? null,
          registration_longitude: coords.longitude ?? null,
          referral_code: referralCode,
          otp_hash: otpHash,
          otp_attempts: 0,
          otp_expires_at: otpExpiresAt,
          device_id: deviceId ?? null,
        },
        update: {
          // User is re-submitting the registration form — refresh all data
          password_hash: hashedPassword,
          first_name: firstName,
          last_name: lastName,
          middle_name: middleName ?? null,
          contact: contact ?? null,
          registration_type: registrationType,
          company_name: companyName ?? null,
          promotional_opt_in: promotionalEmailOptIn,
          registration_ip: ip ?? null,
          registration_location: enhancedLocation ?? null,
          registration_latitude: coords.latitude ?? null,
          registration_longitude: coords.longitude ?? null,
          referral_code: referralCode,
          otp_hash: otpHash,
          otp_attempts: 0,
          otp_expires_at: otpExpiresAt,
          device_id: deviceId ?? null,
        },
      });

      // ── Send OTP Email ──────────────────────────────
      const emailService = EmailService.getInstance();
      const isDev = process.env.NODE_ENV !== "production";
      let emailSent = false;
      let emailError: string | undefined;
      let devOtp: string | undefined;

      const sent = await emailService.sendVerificationEmail({
        email,
        code: rawCode,
        expiresAt: otpExpiresAt,
      });

      emailSent = sent.success;
      if (!sent.success) {
        emailError = sent.error ?? "Unknown error";
        console.error("[register] EMAIL_SEND_FAILED:", emailError);
        await logAuditEvent("EMAIL_SEND_FAILED", undefined, ip, ua, {
          email,
          error: emailError,
          context: "register",
        });
      }
      if (isDev) {
        devOtp = rawCode;
      }

      await logAuditEvent("PENDING_REGISTRATION_CREATED", undefined, ip, ua, {
        email,
        registrationType,
        context: "register",
      });

      // ── Respond ────────────────────────────────────
      // NOTE: We do NOT return a real userId here because no User row exists yet.
      // The frontend uses `email` to call POST /api/auth/verify-email.
      // The verify-email endpoint now accepts `email` (no userId required).
      const response = NextResponse.json(
        {
          message: emailSent
            ? "We've sent a 6-digit verification code to your email. Please enter it to complete registration."
            : "Registration initiated, but the verification email could not be sent. Please use Resend or contact support.",
          // pending: true signals the frontend that the user is in the OTP-first flow
          pending: true,
          email,
          emailVerificationRequired: true,
          emailSent,
          ...(isDev && {
            ...(emailError && { emailError }),
            ...(devOtp && { devOtp }),
          }),
        },
        { status: 200 }
      );

      setCsrfCookie(response, generateCsrfToken());
      return response;
    } catch (error) {
      console.error("[register] Registration error:", error);
      await logAuditEvent("REGISTER_ERROR", undefined, ip, ua, {
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return NextResponse.json(
        { error: "Internal server error." },
        { status: 500 }
      );
    }
  });
}
