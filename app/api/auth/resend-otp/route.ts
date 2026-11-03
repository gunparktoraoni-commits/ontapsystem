// ──────────────────────────────────────────────────────────────
// POST /api/auth/resend-otp — Resend Email Verification OTP
// ──────────────────────────────────────────────────────────────
// Supports both the deferred-creation flow (PendingRegistration) and
// the legacy flow (unverified User row in the main table).
//
// Deferred flow (new):
//   - Looks up PendingRegistration by email (or resolves email from userId)
//   - Generates a new OTP, updates the pending row
//   - Sends the OTP email
//
// Legacy flow (for old unverified users created before this fix):
//   - Looks up the User row
//   - Delegates to VerificationService.resendVerification (unchanged)
//
// Security layers:
//   - Strict IP rate limiting (3 requests per 15 min) — prevents email bombing
//   - 60-second cooldown between OTP sends (enforced via pending row timestamp)
//   - Same generic message returned regardless of lookup result
//   - Audit logged
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import {
  logAuditEvent,
  getClientIp,
  getUserAgent,
} from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { VerificationService } from "@/lib/services/verificationService";
import { EmailService } from "@/lib/services/emailService";

const PENDING_OTP_EXPIRY_MINUTES = 15;
const RESEND_COOLDOWN_SECONDS = 60;

const successMessage =
  "If your registration is pending, a new code has been sent to your email.";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  try {
    // ── Strict Rate Limiting ───────────────────────
    const rateCheck = checkRateLimit("resend-otp", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait before requesting a new code." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    // ── Parse Input ────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    // Accept email (new flow) or userId (legacy / backwards compat)
    const rawEmail =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
    const rawUserId = body.userId ? Number(body.userId) : NaN;
    const hasUserId = !isNaN(rawUserId) && rawUserId > 0;

    if (!rawEmail && !hasUserId) {
      return NextResponse.json(
        { error: "Email or userId is required." },
        { status: 400 }
      );
    }

    // ── Resolve email ──────────────────────────────
    let resolvedEmail: string | null = rawEmail;

    if (!resolvedEmail && hasUserId) {
      // Try PendingRegistration first — userId won't match as there's no user row yet,
      // but we may have persisted the original email as a hint on the frontend.
      // More reliably: check the real User table for legacy flows.
      const userLookup = await prisma.user.findUnique({
        where: { user_id: BigInt(rawUserId) },
        select: { email: true },
      });
      if (userLookup) resolvedEmail = userLookup.email;
    }

    if (!resolvedEmail) {
      // Return generic message — do not reveal whether the record exists
      return NextResponse.json({ message: successMessage, emailSent: false }, { status: 200 });
    }

    // ── Try deferred-creation flow first ──────────
    const pending = await prisma.pendingRegistration.findUnique({
      where: { email: resolvedEmail },
    });

    if (pending) {
      // Enforce cooldown: time since pending row was last updated
      const secondsElapsed = Math.floor(
        (Date.now() - pending.updated_at.getTime()) / 1000
      );
      if (secondsElapsed < RESEND_COOLDOWN_SECONDS) {
        const cooldownRemaining = RESEND_COOLDOWN_SECONDS - secondsElapsed;
        return NextResponse.json(
          {
            error: `Please wait ${cooldownRemaining} seconds before requesting another code.`,
            code: "RATE_LIMIT_EXCEEDED",
            cooldownRemaining,
          },
          {
            status: 429,
            headers: { "Retry-After": String(cooldownRemaining) },
          }
        );
      }

      // Generate fresh OTP and update the pending row
      const verificationService = VerificationService.getInstance();
      const rawCode = verificationService.generateCode();
      const otpHash = verificationService.hashCode(rawCode);
      const otpExpiresAt = new Date(
        Date.now() + PENDING_OTP_EXPIRY_MINUTES * 60 * 1000
      );

      await prisma.pendingRegistration.update({
        where: { email: resolvedEmail },
        data: {
          otp_hash: otpHash,
          otp_attempts: 0,
          otp_expires_at: otpExpiresAt,
        },
      });

      // Send OTP email
      const emailService = EmailService.getInstance();
      const sent = await emailService.sendVerificationEmail({
        email: resolvedEmail,
        code: rawCode,
        expiresAt: otpExpiresAt,
      });

      if (!sent.success) {
        console.error("[resend-otp] EMAIL_SEND_FAILED for pending registration:", resolvedEmail);
        await logAuditEvent("EMAIL_SEND_FAILED", undefined, ip, ua, {
          email: resolvedEmail,
          error: sent.error ?? "EMAIL_SEND_FAILED",
          context: "resend-otp-pending",
        });
        return NextResponse.json(
          {
            error: "Failed to send verification email. Please try again later.",
            code: "EMAIL_SEND_FAILED",
            emailSent: false,
          },
          { status: 502 }
        );
      }

      await logAuditEvent("OTP_RESENT", undefined, ip, ua, {
        email: resolvedEmail,
        context: "resend-otp-pending",
      });

      const isDev = process.env.NODE_ENV !== "production";
      return NextResponse.json(
        {
          message: successMessage,
          emailSent: true,
          ...(isDev && { devNote: "New OTP sent to pending registration." }),
        },
        { status: 200 }
      );
    }

    // ── Legacy flow: User row exists (pre-fix unverified accounts) ─
    const user = await prisma.user.findUnique({
      where: { email: resolvedEmail },
      select: {
        user_id: true,
        email: true,
        first_name: true,
        deactivated_flag: true,
        credentials: { select: { email_verified: true } },
      },
    });

    if (!user || user.deactivated_flag) {
      await logAuditEvent("RESEND_OTP_UNKNOWN_USER", undefined, ip, ua, {
        email: resolvedEmail,
      });
      return NextResponse.json({ message: successMessage, emailSent: false }, { status: 200 });
    }

    // Already verified — no resend needed
    if (user.credentials?.email_verified) {
      return NextResponse.json({ message: successMessage, emailSent: false }, { status: 200 });
    }

    const verificationService = VerificationService.getInstance();
    const resendResult = await verificationService.resendVerification(user.email);

    if (!resendResult.success) {
      if (resendResult.error === "EMAIL_SEND_FAILED") {
        console.error("[resend-otp] EMAIL_SEND_FAILED for legacy user");
        await logAuditEvent("EMAIL_SEND_FAILED", Number(user.user_id), ip, ua, {
          error: "EMAIL_SEND_FAILED",
          context: "resend-otp-legacy",
        });
        return NextResponse.json(
          {
            error: "Failed to send verification email. Please try again later.",
            code: "EMAIL_SEND_FAILED",
          },
          { status: 502 }
        );
      }

      if (resendResult.error === "RATE_LIMIT_EXCEEDED") {
        return NextResponse.json(
          {
            error: `Please wait ${resendResult.cooldownRemaining ?? 60} seconds before requesting another code.`,
            code: "RATE_LIMIT_EXCEEDED",
          },
          {
            status: 429,
            headers: resendResult.cooldownRemaining
              ? { "Retry-After": String(resendResult.cooldownRemaining) }
              : undefined,
          }
        );
      }
    }

    await logAuditEvent("OTP_RESENT", Number(user.user_id), ip, ua, {
      context: "resend-otp-legacy",
    });

    const isDev = process.env.NODE_ENV !== "production";
    return NextResponse.json(
      {
        message: successMessage,
        emailSent: true,
        ...(isDev && resendResult.success
          ? { devNote: "Check inbox and spam folder for the verification code." }
          : {}),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[resend-otp] Error:", error);
    await logAuditEvent("RESEND_OTP_ERROR", undefined, ip, ua, {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
