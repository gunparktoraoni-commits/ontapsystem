import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { prisma } from "@/server/lib/prisma";
import {
  createReverificationStateToken,
  getClientIp,
  getUserAgent,
  logAuditEvent,
  getReauthStateCookieOptions,
} from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { parseTransports, resolveWebAuthnConfig } from "@/server/lib/webauthn";

/**
 * POST /api/auth/webauthn/login/options
 * 
 * Generates WebAuthn authentication options for biometric login.
 * This endpoint is used during the password login flow to enable
 * automatic biometric authentication if the user has enrolled credentials.
 * 
 * Request body:
 * - email: string (required) - The user's email address
 * 
 * Security:
 * - IP rate limiting applied
 * - No authentication required (pre-login)
 * - Email must exist and have enrolled credentials
 * - Challenge stored in reauth_state cookie for verification
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  try {
    const rateCheck = checkRateLimit("webauthn-login-options", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }

    // Find user by email and check for enrolled credentials
    const user = await prisma.user.findFirst({
      where: { email },
      select: {
        user_id: true,
        email: true,
        first_name: true,
        deactivated_flag: true,
        deleted_at: true,
        webauthnCredentials: {
          select: { credential_id: true, transports: true },
        },
      },
    });

    // Generic error to prevent email enumeration
    if (!user) {
      await logAuditEvent("WEBAUTHN_LOGIN_OPTIONS_USER_NOT_FOUND", undefined, ip, ua, { email });
      return NextResponse.json(
        { error: "Unable to authenticate with biometrics." },
        { status: 404 }
      );
    }

    if (user.deleted_at) {
      return NextResponse.json({ error: "This account is no longer available." }, { status: 403 });
    }

    if (user.deactivated_flag) {
      return NextResponse.json({ error: "This account has been deactivated." }, { status: 403 });
    }

    if (user.webauthnCredentials.length === 0) {
      return NextResponse.json(
        {
          error: "No passkey is enrolled for this account.",
          code: "NO_WEBAUTHN_CREDENTIAL",
          webauthnAvailable: false,
        },
        { status: 409 }
      );
    }

    const { rpId } = resolveWebAuthnConfig(request.url);
    const options = await generateAuthenticationOptions({
      rpID: rpId,
      allowCredentials: user.webauthnCredentials.map((credential) => ({
        id: credential.credential_id,
        type: "public-key" as const,
        transports: parseTransports(credential.transports),
      })),
      userVerification: "required",
      timeout: 60000,
    });

    // Store challenge and user context for verification
    const nextState = createReverificationStateToken({
      userId: Number(user.user_id),
      email: user.email,
      purpose: "webauthn_login",
      challenge: options.challenge,
    });

    const response = NextResponse.json({
      options,
      webauthnAvailable: true,
      user: {
        userId: Number(user.user_id),
        email: user.email,
        firstName: user.first_name,
      },
    });

    response.cookies.set("reauth_state", nextState.token, getReauthStateCookieOptions(15 * 60));

    await logAuditEvent("WEBAUTHN_LOGIN_OPTIONS_SUCCESS", Number(user.user_id), ip, ua);
    return response;
  } catch (error) {
    console.error("[webauthn/login/options] error:", error);
    await logAuditEvent("WEBAUTHN_LOGIN_OPTIONS_ERROR", undefined, ip, ua, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
