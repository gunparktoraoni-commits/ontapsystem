import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { prisma } from "@/server/lib/prisma";
import {
  createSession,
  getClientIp,
  getUserAgent,
  logAuditEvent,
  parseReverificationStateToken,
  getReauthStateCookieOptions,
} from "@/server/lib/auth";
import { recordSuccessfulLogin } from "@/server/lib/rate-limit";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { resolveWebAuthnConfig } from "@/server/lib/webauthn";
import { SuperadminSettingsService } from "@/lib/services/superadmin-settings.service";
import { ensureAliasLockStarted } from "@/lib/bizcard/url-alias-utils";
import { SubscriptionAccessService, buildAccessRedirectUrl } from "@/lib/services/subscription-access.service";
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

/**
 * POST /api/auth/webauthn/login/verify
 * 
 * Verifies WebAuthn authentication response for biometric login.
 * This endpoint completes the biometric authentication flow initiated
 * after successful password verification.
 * 
 * Request body:
 * - credential: WebAuthn authentication credential response
 * - deviceId: (optional) Device fingerprint for linking
 * - rememberMe: (optional) Whether to create a persistent session
 * 
 * Security:
 * - IP rate limiting applied
 * - Validates against stored challenge in reauth_state cookie
 * - Checks credential ownership and account status
 * - Updates credential counter to prevent replay attacks
 * - Creates session with appropriate duration based on rememberMe flag
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);
  const geo = extractGeoMetadata(request);
  const location = geo.city && geo.country ? `${geo.city}, ${geo.country}` : geo.country ?? null;

  // Get enhanced geolocation data from IP service
  const ipGeoData = await getGeolocationFromIP(ip);
  const enhancedLocation = ipGeoData ? getLocationString(ipGeoData) : location;
  const coords = ipGeoData ? getCoordinates(ipGeoData) : { latitude: geo.latitude, longitude: geo.longitude };

  try {
    const rateCheck = checkRateLimit("webauthn-login-verify", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    const stateToken = request.cookies.get("reauth_state")?.value;
    const state = stateToken ? parseReverificationStateToken(stateToken) : null;
    if (!state || state.purpose !== "webauthn_login" || !state.challenge) {
      return NextResponse.json({ error: "Verification required." }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const response = body.credential ?? body.response ?? body;
    if (!response || typeof response !== "object") {
      return NextResponse.json({ error: "Missing WebAuthn response." }, { status: 400 });
    }

    const credentialId = typeof (response as { id?: unknown }).id === "string" ? (response as { id: string }).id : "";
    if (!credentialId) {
      return NextResponse.json({ error: "Missing credential ID." }, { status: 400 });
    }

    const credential = await prisma.webAuthnCredential.findUnique({
      where: { credential_id: credentialId },
      select: {
        id: true,
        user_id: true,
        credential_id: true,
        public_key: true,
        counter: true,
        transports: true,
        device_type: true,
        backed_up: true,
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
            credentials: {
              select: { must_change_password: true },
            },
          },
        },
      },
    });

    if (!credential || credential.user.email.toLowerCase() !== state.email.toLowerCase()) {
      await logAuditEvent("WEBAUTHN_LOGIN_UNKNOWN_CREDENTIAL", state.userId, ip, ua, { credentialId });
      return NextResponse.json({ error: "Authentication failed." }, { status: 401 });
    }

    if (credential.user.deleted_at) {
      return NextResponse.json({ error: "This account is no longer available." }, { status: 403 });
    }

    if (credential.user.deactivated_flag) {
      return NextResponse.json({ error: "This account has been deactivated." }, { status: 403 });
    }

    const { origin, rpId } = resolveWebAuthnConfig(request.url);
    const verification = await verifyAuthenticationResponse({
      response: response as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
      expectedChallenge: state.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      credential: {
        id: credential.credential_id,
        publicKey: credential.public_key,
        counter: credential.counter,
        transports: credential.transports ? credential.transports.split(",").filter(Boolean) as never : undefined,
      },
      requireUserVerification: true,
    });

    if (!verification.verified) {
      await logAuditEvent("WEBAUTHN_LOGIN_VERIFY_FAILED", Number(credential.user_id), ip, ua, { credentialId });
      return NextResponse.json({ error: "Authentication failed." }, { status: 401 });
    }

    // Update credential counter and last used timestamp
    await prisma.webAuthnCredential.update({
      where: { credential_id: credential.credential_id },
      data: {
        counter: verification.authenticationInfo.newCounter,
        last_used_at: new Date(),
        updated_at: new Date(),
      },
    });

    const rememberMe = Boolean(body.rememberMe ?? body.remember_me);

    // Create session and update user record (parallel operations)
    const [, createdSession] = await Promise.all([
      recordSuccessfulLogin(credential.user.email, ip),
      createSession(
        {
          userId: Number(credential.user.user_id),
          email: credential.user.email,
          role: credential.user.role,
        },
        rememberMe,
        ip,
        ua,
        { location: enhancedLocation }
      ),
      logAuditEvent("WEBAUTHN_LOGIN_SUCCESS", Number(credential.user_id), ip, ua, {
        credentialId,
        rememberMe,
      }),
      prisma.user.update({
        where: { user_id: credential.user_id },
        data: {
          last_login_ip: ip,
          last_login_location: enhancedLocation,
          last_login_latitude: coords.latitude,
          last_login_longitude: coords.longitude,
          last_login_country: ipGeoData?.country || geo.country,
          last_login_city: ipGeoData?.city || geo.city,
          last_login_at: new Date(),
          last_reverification_at: new Date(),
        },
      }),
    ]);

    // Stamp 90-day alias lock for migrated users who never received last_url_alias_changed_at.
    try {
      await ensureAliasLockStarted(credential.user_id);
    } catch (aliasLockError) {
      console.error("[webauthn/login/verify] Failed to ensure alias lock:", aliasLockError);
    }

    // Link device to user (if provided)
    const deviceId = body.deviceId || body.device_id || body.deviceFingerprint || body.device_fingerprint;
    if (deviceId && isValidFingerprint(deviceId)) {
      try {
        const deviceService = new DeviceService(`webauthn-login:${Number(credential.user_id)}`);
        await deviceService.linkDeviceToUser(deviceId as string, credential.user_id);
      } catch (deviceError) {
        console.error("[webauthn-login] Failed to link device:", deviceError);
        // Non-fatal: user is logged in successfully
      }
    }

    // Track superadmin login if applicable
    if (credential.user.role.toLowerCase() === "super_admin") {
      const settingsService = new SuperadminSettingsService(`webauthn-login:${Number(credential.user_id)}`);
      settingsService
        .recordLogin({
          userId: Number(credential.user_id),
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

      ensureSuperadminBizcardsPremium(credential.user_id).catch((error) => {
        console.error("Superadmin permanent premium sync failed:", error);
      });
    }

    // Check subscription access status
    const accessService = new SubscriptionAccessService(`webauthn-login:${Number(credential.user_id)}`);
    const accessStatus = await accessService.getUserAccessStatus(credential.user_id);

    const responseJson: Record<string, unknown> = {
      message: "Biometric authentication successful.",
      user: {
        userId: Number(credential.user.user_id),
        email: credential.user.email,
        firstName: credential.user.first_name,
        lastName: credential.user.last_name,
        role: credential.user.role,
        customUri: credential.user.custom_uri,
        requiresPasswordChange: credential.user.credentials?.must_change_password === true,
        requiresEmailChange: isForcedPlaceholderEmail(credential.user.email),
      },
      session: createdSession.session,
      biometric: {
        authenticated: true,
        method: "webauthn",
      },
    };

    responseJson.accessStatus = accessStatus;

    // Add redirect info if the user has no active access
    if (!accessStatus.hasAccess) {
      responseJson.requiresUpgrade = true;
      responseJson.requires_upgrade = true;
      const redirectTarget = buildAccessRedirectUrl(accessStatus.reason);
      responseJson.redirectUrl = redirectTarget;
      responseJson.redirect_url = redirectTarget;
      responseJson.subscriptionStatus = accessStatus.reason;
    } else if (accessStatus.reason === "free_trial" && (accessStatus.daysRemaining ?? 0) <= 7) {
      responseJson.trialWarning = true;
      responseJson.trialDaysRemaining = accessStatus.daysRemaining;
    }

    const next = NextResponse.json(serialize(responseJson));
    next.cookies.set("reauth_state", "", getReauthStateCookieOptions(0));

    return next;
  } catch (error) {
    console.error("[webauthn/login/verify] error:", error);
    await logAuditEvent("WEBAUTHN_LOGIN_VERIFY_ERROR", undefined, ip, ua, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
