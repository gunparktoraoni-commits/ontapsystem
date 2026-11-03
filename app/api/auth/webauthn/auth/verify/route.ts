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
import { checkRateLimit } from "@/server/lib/rate-limit";
import { resolveWebAuthnConfig } from "@/server/lib/webauthn";
import { ensureAliasLockStarted } from "@/lib/bizcard/url-alias-utils";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  try {
    const rateCheck = checkRateLimit("webauthn-auth-verify", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    const stateToken = request.cookies.get("reauth_state")?.value;
    const state = stateToken ? parseReverificationStateToken(stateToken) : null;
    if (!state || state.purpose !== "webauthn_auth" || !state.challenge) {
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
            deactivated_flag: true,
          },
        },
      },
    });

    if (!credential || credential.user.email.toLowerCase() !== state.email.toLowerCase()) {
      await logAuditEvent("WEBAUTHN_AUTH_UNKNOWN_CREDENTIAL", state.userId, ip, ua, { credentialId });
      return NextResponse.json({ error: "Authentication failed." }, { status: 401 });
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
      await logAuditEvent("WEBAUTHN_AUTH_VERIFY_FAILED", Number(credential.user_id), ip, ua, { credentialId });
      return NextResponse.json({ error: "Authentication failed." }, { status: 401 });
    }

    await prisma.$transaction([
      prisma.webAuthnCredential.update({
        where: { credential_id: credential.credential_id },
        data: {
          counter: verification.authenticationInfo.newCounter,
          last_used_at: new Date(),
          updated_at: new Date(),
        },
      }),
      prisma.user.update({
        where: { user_id: credential.user_id },
        data: { last_reverification_at: new Date() },
      }),
    ]);

    const createdSession = await createSession(
      {
        userId: Number(credential.user.user_id),
        email: credential.user.email,
        role: credential.user.role,
      },
      false,
      ip,
      ua,
    );

    // Stamp 90-day alias lock for migrated users (login may have returned REVERIFICATION_REQUIRED before stamping).
    try {
      await ensureAliasLockStarted(credential.user_id);
    } catch (aliasLockError) {
      console.error("[webauthn/auth/verify] Failed to ensure alias lock:", aliasLockError);
    }

    const responseJson = NextResponse.json({
      message: "Verification successful.",
      user: {
        userId: Number(credential.user.user_id),
        email: credential.user.email,
        firstName: credential.user.first_name,
        lastName: credential.user.last_name,
        role: credential.user.role,
      },
      session: createdSession.session,
    });

    responseJson.cookies.set("reauth_state", "", getReauthStateCookieOptions(0));

    await logAuditEvent("WEBAUTHN_AUTH_SUCCESS", Number(credential.user_id), ip, ua, { credentialId });

    return responseJson;
  } catch (error) {
    console.error("[webauthn/auth/verify] error:", error);
    await logAuditEvent("WEBAUTHN_AUTH_VERIFY_ERROR", undefined, ip, ua, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
