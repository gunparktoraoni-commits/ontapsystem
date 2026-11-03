// ──────────────────────────────────────────────────────────────
// POST /api/auth/verify-email — OTP Verification + Account Creation
// ──────────────────────────────────────────────────────────────
// This endpoint completes the deferred-creation registration flow.
//
// Flow:
//   1. User submits the 6-digit OTP along with their email
//   2. Backend finds the PendingRegistration row for that email
//   3. OTP is validated (HMAC timing-safe comparison)
//   4. On success: the real User account is atomically created in the DB
//      using the data stored in PendingRegistration
//   5. The PendingRegistration row is deleted
//   6. A session is created (user is logged in)
//   7. Frontend redirects to BizCard setup
//
// WHY email instead of userId:
//   Under the deferred flow no User row exists before verification,
//   so there is no userId to return from /register. We identify the
//   pending record by email, which is unique in PendingRegistration.
//
// Security layers:
//   - IP rate limiting (10 attempts per 15 min)
//   - Per-OTP attempt limit (5) enforced in PendingRegistration row
//   - OTP is HMAC-SHA-256 hashed; comparison is timing-safe
//   - OTP expires after 15 minutes
//   - PendingRegistration row is deleted atomically after use
//   - Specific error codes returned so frontend can show appropriate UI
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import {
  createSession,
  logAuditEvent,
  getClientIp,
  getUserAgent,
} from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { VerificationService } from "@/lib/services/verificationService";
import { SubscriptionAccessService } from "@/lib/services/subscription-access.service";
import {
  ensureAffiliateEnrollment,
  generateAffiliateCode,
} from "@/server/lib/affiliate";
import { generateUniqueUrlAlias } from "@/lib/bizcard/url-generator";
import {
  getDefaultPreferences,
  getOrCreateNotificationPreference,
} from "@/server/lib/notifications";
import { DeviceService } from "@/lib/services/device.service";
import { isValidFingerprint } from "@/lib/utils/device-fingerprint";
import { Prisma } from "@prisma/client";
import crypto from "crypto";
import {
  createPendingReferral,
  resolveReferrerFromCode,
} from "@/server/lib/growth-referral";

const MAX_OTP_ATTEMPTS = 5;
const AFFILIATE_REF_COOKIE = "__affiliate_ref";

// ── Helpers (mirrored from original register route) ────────────

async function syncNotificationPreferenceEmailVerified(
  userId: bigint
): Promise<void> {
  try {
    const pref = await getOrCreateNotificationPreference(userId);
    if (!pref.email_verified) {
      await prisma.notificationPreference.update({
        where: { user_id: userId },
        data: { email_verified: true },
      });
    }
  } catch (error) {
    console.error(
      "[verify-email] Failed to sync notification preference email_verified:",
      error
    );
  }
}

async function applyPromotionalEmailOptIn(
  userId: bigint,
  optedIn: boolean
): Promise<void> {
  if (!optedIn) return;
  try {
    const pref = await getOrCreateNotificationPreference(userId);
    const defaults = getDefaultPreferences();
    let existing: Record<string, unknown> = defaults;
    try {
      const parsed: unknown = JSON.parse(pref.preferences);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        existing = { ...defaults, ...(parsed as Record<string, unknown>) };
      }
    } catch {
      // use defaults
    }
    const promotional =
      existing.promotional && typeof existing.promotional === "object" && !Array.isArray(existing.promotional)
        ? { ...(existing.promotional as Record<string, unknown>) }
        : { ...(defaults.promotional as Record<string, unknown>) };
    promotional.email = true;
    existing.promotional = promotional;
    await prisma.notificationPreference.update({
      where: { user_id: userId },
      data: {
        preferences: JSON.stringify(existing),
        email_verified: true,
      },
    });
  } catch (error) {
    console.error("[verify-email] Failed to save promotional email opt-in:", error);
  }
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  try {
    // ── IP Rate Limiting ───────────────────────────
    const rateCheck = checkRateLimit("verify-email", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many verification attempts. Please try again later." },
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

    // Accept either { email, otp } (new deferred flow)
    // or legacy { userId, otp } (will be resolved via userId → email lookup)
    const rawOtp = typeof body.otp === "string" ? body.otp.trim() : "";
    if (!rawOtp || rawOtp.length !== 6) {
      return NextResponse.json(
        { error: "Verification code must be exactly 6 digits." },
        { status: 400 }
      );
    }
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(rawOtp)) {
      return NextResponse.json(
        { error: "Verification code contains invalid characters." },
        { status: 400 }
      );
    }

    // Resolve email: prefer direct email, fall back to userId lookup for backwards compat
    let resolvedEmail: string | null = null;

    const rawEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
    if (rawEmail) {
      resolvedEmail = rawEmail;
    } else if (body.userId) {
      const userId = Number(body.userId);
      if (!isNaN(userId) && userId > 0) {
        const lookup = await prisma.user.findUnique({
          where: { user_id: BigInt(userId) },
          select: { email: true },
        });
        if (lookup) resolvedEmail = lookup.email;
      }
    }

    if (!resolvedEmail) {
      return NextResponse.json(
        { error: "Email address is required." },
        { status: 400 }
      );
    }

    // ── Determine if this is the deferred-creation flow ─
    // Check PendingRegistration first (new flow).
    // If not found there, fall back to the legacy path (existing User row).
    const pending = await prisma.pendingRegistration.findUnique({
      where: { email: resolvedEmail },
    });

    if (pending) {
      // ── NEW DEFERRED-CREATION FLOW ──────────────────

      // Check OTP expiry
      if (pending.otp_expires_at < new Date()) {
        await logAuditEvent("EMAIL_OTP_EXPIRED", undefined, ip, ua, {
          email: resolvedEmail,
          context: "verify-email-pending",
        });
        return NextResponse.json(
          {
            error: "Verification code has expired. Please request a new one.",
            code: "OTP_EXPIRED",
          },
          { status: 400 }
        );
      }

      // Check attempt limit
      if (pending.otp_attempts >= MAX_OTP_ATTEMPTS) {
        await logAuditEvent("EMAIL_OTP_MAX_ATTEMPTS", undefined, ip, ua, {
          email: resolvedEmail,
          context: "verify-email-pending",
        });
        return NextResponse.json(
          {
            error:
              "Too many incorrect attempts. Please request a new verification code.",
            code: "OTP_MAX_ATTEMPTS",
          },
          { status: 429 }
        );
      }

      // Validate OTP (HMAC timing-safe)
      const verificationService = VerificationService.getInstance();
      const isValid = verificationService.verifyCode(rawOtp, pending.otp_hash);

      if (!isValid) {
        // Increment attempt counter
        const updatedAttempts = pending.otp_attempts + 1;
        await prisma.pendingRegistration.update({
          where: { email: resolvedEmail },
          data: { otp_attempts: updatedAttempts },
        });

        if (updatedAttempts >= MAX_OTP_ATTEMPTS) {
          await logAuditEvent("EMAIL_OTP_MAX_ATTEMPTS", undefined, ip, ua, {
            email: resolvedEmail,
            context: "verify-email-pending",
          });
          return NextResponse.json(
            {
              error:
                "Too many incorrect attempts. Please request a new verification code.",
              code: "OTP_MAX_ATTEMPTS",
            },
            { status: 429 }
          );
        }

        await logAuditEvent("EMAIL_OTP_INVALID", undefined, ip, ua, {
          email: resolvedEmail,
          context: "verify-email-pending",
        });
        return NextResponse.json(
          {
            error: "Invalid verification code. Please check and try again.",
            code: "OTP_INVALID",
          },
          { status: 400 }
        );
      }

      // ── OTP VALID — Create the User Account Now ──────
      // This is the ONLY place in the entire system where a User record
      // is persisted for the registration flow. All prior steps work
      // exclusively with PendingRegistration.

      const {
        password_hash: hashedPassword,
        first_name: firstName,
        last_name: lastName,
        middle_name: middleName,
        contact,
        registration_type: registrationType,
        company_name: companyName,
        promotional_opt_in: promotionalEmailOptIn,
        registration_ip: regIp,
        registration_location: regLocation,
        registration_latitude: regLat,
        registration_longitude: regLon,
        device_id: deviceId,
        referral_code: pendingReferralCode,
      } = pending;

      const role = registrationType === "company" ? "company_admin" : "user";
      const customUri = `${firstName.toLowerCase()}-${lastName.toLowerCase()}-${crypto.randomBytes(3).toString("hex")}`;

      let createdUserId: number;
      let companyId: number | null = null;

      if (registrationType === "company") {
        // ── Company Registration ──────────────────────
        const securityKey = crypto.randomBytes(32).toString("hex");
        const maxAttempts = 5;
        let createdCompany: { company_id: bigint } | null = null;
        let createdUserRow: { user_id: bigint } | null = null;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const code = generateAffiliateCode();
          try {
            const txResult = await prisma.$transaction(async (tx) => {
              const company = await tx.company.create({
                data: {
                  name: companyName!,
                  security_key: securityKey,
                },
              });

              const user = await tx.user.create({
                data: {
                  role,
                  registration_type: "company",
                  first_name: firstName,
                  last_name: lastName,
                  middle_name: middleName,
                  contact,
                  email: resolvedEmail!,
                  custom_uri: customUri,
                  company_id: company.company_id,
                  registration_ip: regIp,
                  registration_location: regLocation,
                  registration_latitude: regLat,
                  registration_longitude: regLon,
                  affiliate_code: code,
                  is_affiliate: true,
                  affiliate_joined_at: new Date(),
                  credentials: {
                    create: {
                      password_hash: hashedPassword,
                      email_verified: true, // verified NOW — OTP was just confirmed
                      email_verified_at: new Date(),
                    },
                  },
                  permissions: { create: {} },
                },
              });

              await tx.company.update({
                where: { company_id: company.company_id },
                data: { admin_id: user.user_id },
              });

              // Delete the pending row atomically with user creation
              await tx.pendingRegistration.delete({ where: { email: resolvedEmail! } });

              return { company, user };
            }, { timeout: 15000 }); // 15s — company creation involves multiple writes

            // affiliateSettings.upsert moved outside tx to reduce transaction scope
            await prisma.affiliateSettings.upsert({
              where: { user_id: BigInt(txResult.user.user_id) },
              create: { user_id: BigInt(txResult.user.user_id) },
              update: {},
            });

            createdCompany = txResult.company;
            createdUserRow = txResult.user;
            break;
          } catch (err) {
            if (
              err instanceof Prisma.PrismaClientKnownRequestError &&
              err.code === "P2002"
            ) {
              const target = (err.meta && (err.meta as { target?: unknown }).target) || [];
              if (Array.isArray(target) && target.includes("affiliate_code")) {
                continue; // retry on affiliate_code collision
              }
            }
            throw err;
          }
        }

        if (!createdUserRow || !createdCompany) {
          throw new Error(
            "[verify-email] Failed to create company and user after multiple attempts"
          );
        }

        createdUserId = Number(createdUserRow.user_id);
        companyId = Number(createdCompany.company_id);

        await ensureAffiliateEnrollment(createdUserRow.user_id);
        await syncNotificationPreferenceEmailVerified(createdUserRow.user_id);
        await applyPromotionalEmailOptIn(createdUserRow.user_id, promotionalEmailOptIn);

        // Create placeholder BizCard
        try {
          const placeholderUrlAlias = await generateUniqueUrlAlias({
            requestedAlias: `user_${createdUserRow.user_id.toString()}`,
            firstName,
            lastName,
            userId: createdUserRow.user_id,
          });
          await prisma.bizcard.create({
            data: {
              user_id: createdUserRow.user_id,
              bizcard_name: `${firstName} ${lastName}`,
              url_alias: placeholderUrlAlias,
              first_name: firstName,
              last_name: lastName,
              middle_name: middleName || null,
              email: resolvedEmail!,
              contact_number: contact ?? "",
              city: "",
              bizcard_type: "virtual",
              is_blank: true,
              generated_by_user_id: createdUserRow.user_id,
              claimed_by_user_id: null,
              generated_at: new Date(),
              created_at: new Date(),
              last_url_alias_changed_at: null,
            },
          });
        } catch (placeholderError) {
          console.error("[verify-email] Failed to create placeholder bizcard:", placeholderError);
        }

        // Link device if present
        if (deviceId && isValidFingerprint(deviceId)) {
          try {
            const deviceService = new DeviceService(crypto.randomUUID());
            await deviceService.linkDeviceToUser(deviceId, BigInt(createdUserId));
          } catch (deviceError) {
            console.error("[verify-email] Failed to link device:", deviceError);
          }
        }

        await logAuditEvent("COMPANY_REGISTER_SUCCESS", createdUserId, ip, ua, {
          company_id: companyId,
          company_name: companyName,
        });
      } else {
        // ── Individual Registration ───────────────────
        const maxAttemptsInd = 5;
        let createdIndUser: { user_id: bigint } | null = null;

        for (let attempt = 0; attempt < maxAttemptsInd; attempt++) {
          const code = generateAffiliateCode();
          try {
            createdIndUser = await prisma.$transaction(async (tx) => {
              const u = await tx.user.create({
                data: {
                  role,
                  registration_type: "individual",
                  first_name: firstName,
                  last_name: lastName,
                  middle_name: middleName,
                  contact,
                  email: resolvedEmail!,
                  custom_uri: customUri,
                  registration_ip: regIp,
                  registration_location: regLocation,
                  registration_latitude: regLat,
                  registration_longitude: regLon,
                  affiliate_code: code,
                  is_affiliate: true,
                  affiliate_joined_at: new Date(),
                  credentials: {
                    create: {
                      password_hash: hashedPassword,
                      email_verified: true, // verified NOW — OTP was just confirmed
                      email_verified_at: new Date(),
                    },
                  },
                  permissions: { create: {} },
                },
              });

              // Delete the pending row atomically with user creation.
              // affiliateSettings.upsert moved outside tx to keep transaction lean.
              await tx.pendingRegistration.delete({ where: { email: resolvedEmail! } });

              return u;
            }, { timeout: 10000 }); // 10s — individual creation is simpler than company

            // Run affiliateSettings.upsert outside the transaction to avoid timeout
            if (createdIndUser) {
              await prisma.affiliateSettings.upsert({
                where: { user_id: BigInt(createdIndUser.user_id) },
                create: { user_id: BigInt(createdIndUser.user_id) },
                update: {},
              });
            }
            break;
          } catch (err) {
            if (
              err instanceof Prisma.PrismaClientKnownRequestError &&
              err.code === "P2002"
            ) {
              const target = (err.meta && (err.meta as { target?: unknown }).target) || [];
              if (Array.isArray(target) && target.includes("affiliate_code")) {
                continue; // retry on affiliate_code collision
              }
            }
            throw err;
          }
        }

        if (!createdIndUser) {
          throw new Error(
            "[verify-email] Failed to create individual user after multiple attempts"
          );
        }

        const user = createdIndUser;

        await new SubscriptionAccessService(
          `register:${user.user_id.toString()}`
        ).initializeFreeTrial(user.user_id);

        await ensureAffiliateEnrollment(user.user_id);
        await syncNotificationPreferenceEmailVerified(user.user_id);
        await applyPromotionalEmailOptIn(user.user_id, promotionalEmailOptIn);

        // Create placeholder BizCard
        try {
          const placeholderUrlAlias = await generateUniqueUrlAlias({
            requestedAlias: `user_${user.user_id.toString()}`,
            firstName,
            lastName,
            userId: user.user_id,
          });
          await prisma.bizcard.create({
            data: {
              user_id: user.user_id,
              bizcard_name: `${firstName} ${lastName}`,
              url_alias: placeholderUrlAlias,
              first_name: firstName,
              last_name: lastName,
              middle_name: middleName || null,
              email: resolvedEmail!,
              contact_number: contact ?? "",
              city: "",
              bizcard_type: "virtual",
              is_blank: true,
              generated_by_user_id: user.user_id,
              claimed_by_user_id: null,
              generated_at: new Date(),
              created_at: new Date(),
              last_url_alias_changed_at: null,
            },
          });
        } catch (placeholderError) {
          console.error("[verify-email] Failed to create placeholder bizcard:", placeholderError);
        }

        createdUserId = Number(user.user_id);

        // Link device if present
        if (deviceId && isValidFingerprint(deviceId)) {
          try {
            const deviceService = new DeviceService(crypto.randomUUID());
            await deviceService.linkDeviceToUser(deviceId, BigInt(createdUserId));
          } catch (deviceError) {
            console.error("[verify-email] Failed to link device:", deviceError);
          }
        }

        await logAuditEvent("REGISTER_SUCCESS", createdUserId, ip, ua);
      }

      // ── Growth referral: create PENDING relationship (if attributed) ──
      try {
        const referrer = await resolveReferrerFromCode(pendingReferralCode);
        if (referrer) {
          await createPendingReferral({
            referrerId: referrer.user_id,
            referredUserId: createdUserId,
          });
        }
      } catch (referralError) {
        console.error("[verify-email] Failed to create pending referral:", referralError);
      }

      // ── Fetch the newly created user for session ──
      const newUser = await prisma.user.findUnique({
        where: { user_id: BigInt(createdUserId) },
        select: {
          user_id: true,
          email: true,
          first_name: true,
          last_name: true,
          role: true,
          custom_uri: true,
          deactivated_flag: true,
        },
      });

      if (!newUser) {
        return NextResponse.json(
          { error: "Account created but user lookup failed. Please log in." },
          { status: 500 }
        );
      }

      // ── Create session ────────────────────────────
      await createSession(
        {
          userId: Number(newUser.user_id),
          email: newUser.email,
          role: newUser.role,
        },
        false,
        ip,
        ua
      );

      await logAuditEvent("EMAIL_VERIFIED", Number(newUser.user_id), ip, ua);

      const successResponse = NextResponse.json(
        {
          message: "Email verified successfully. Your account has been created.",
          userId: Number(newUser.user_id),
          ...(companyId !== null && { companyId }),
          user: {
            userId: Number(newUser.user_id),
            email: newUser.email,
            firstName: newUser.first_name,
            lastName: newUser.last_name,
            role: newUser.role,
            customUri: newUser.custom_uri,
          },
        },
        { status: 200 }
      );
      successResponse.cookies.set(AFFILIATE_REF_COOKIE, "", {
        maxAge: 0,
        path: "/",
      });
      return successResponse;
    }

    // ── LEGACY PATH: User row already exists (pre-fix data) ──────
    // This handles users who were registered under the old flow (account
    // already in DB, email not yet verified). Supports a seamless transition.
    const lookup = await prisma.user.findUnique({
      where: { email: resolvedEmail },
      select: { email: true, user_id: true },
    });

    if (!lookup) {
      return NextResponse.json(
        {
          error: "No registration found for this email. Please register again.",
          code: "NOT_FOUND",
        },
        { status: 404 }
      );
    }

    const verificationService = VerificationService.getInstance();
    const verificationResult = await verificationService.validateCode(
      resolvedEmail,
      rawOtp
    );

    const result = verificationResult.valid
      ? "verified"
      : verificationResult.error === "NO_ACTIVE_CODE"
        ? "expired"
        : verificationResult.error === "MAX_ATTEMPTS_EXCEEDED"
          ? "max_attempts"
          : "invalid";

    if (result === "expired") {
      await logAuditEvent("EMAIL_OTP_EXPIRED", Number(lookup.user_id), ip, ua);
      return NextResponse.json(
        {
          error: "Verification code has expired. Please request a new one.",
          code: "OTP_EXPIRED",
        },
        { status: 400 }
      );
    }

    if (result === "max_attempts") {
      await logAuditEvent("EMAIL_OTP_MAX_ATTEMPTS", Number(lookup.user_id), ip, ua);
      return NextResponse.json(
        {
          error:
            "Too many incorrect attempts. Please request a new verification code.",
          code: "OTP_MAX_ATTEMPTS",
        },
        { status: 429 }
      );
    }

    if (result === "invalid") {
      await logAuditEvent("EMAIL_OTP_INVALID", Number(lookup.user_id), ip, ua);
      return NextResponse.json(
        {
          error: "Invalid verification code. Please check and try again.",
          code: "OTP_INVALID",
        },
        { status: 400 }
      );
    }

    // Legacy OTP verified — fetch user and create session
    const user = await prisma.user.findUnique({
      where: { user_id: lookup.user_id },
      select: {
        user_id: true,
        email: true,
        first_name: true,
        last_name: true,
        role: true,
        custom_uri: true,
        deactivated_flag: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    if (user.deactivated_flag) {
      return NextResponse.json(
        { error: "This account has been deactivated." },
        { status: 403 }
      );
    }

    await createSession(
      {
        userId: Number(user.user_id),
        email: user.email,
        role: user.role,
      },
      false,
      ip,
      ua
    );

    await logAuditEvent("EMAIL_VERIFIED", Number(user.user_id), ip, ua);

    return NextResponse.json(
      {
        message: "Email verified successfully.",
        userId: Number(user.user_id),
        user: {
          userId: Number(user.user_id),
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
          customUri: user.custom_uri,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[verify-email] Error:", error);
    await logAuditEvent("EMAIL_VERIFY_ERROR", undefined, ip, ua, {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
