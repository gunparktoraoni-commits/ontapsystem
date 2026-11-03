import { NextRequest, NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { prisma } from "@/server/lib/prisma";
import { createSession, getSession, logAuditEvent, parseReverificationStateToken, getReauthStateCookieOptions } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { resolveWebAuthnConfig, serializeTransports } from "@/server/lib/webauthn";

export async function POST(request: NextRequest) {
  const session = await getSession();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ua = request.headers.get("user-agent") ?? "unknown";

  try {
    const rateCheck = checkRateLimit("webauthn-register-verify", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    if (!session) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const state = parseReverificationStateToken(request.cookies.get("reauth_state")?.value ?? "");
    if (!state || state.purpose !== "webauthn_register" || !state.challenge) {
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

    const { origin, rpId } = resolveWebAuthnConfig(request.url);
    const verification = await verifyRegistrationResponse({
      response: response as Parameters<typeof verifyRegistrationResponse>[0]["response"],
      expectedChallenge: state.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      requireUserPresence: true,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: "Registration failed." }, { status: 400 });
    }

    const credentialId = verification.registrationInfo.credential.id;
    await prisma.webAuthnCredential.create({
      data: {
        user_id: BigInt(Number(session.userId)),
        credential_id: credentialId,
        credential_name: `Passkey ${new Date().toISOString()}`,
        public_key: Buffer.from(verification.registrationInfo.credential.publicKey),
        counter: verification.registrationInfo.credential.counter,
        transports: serializeTransports((response as { response?: { transports?: unknown } }).response && Array.isArray((response as { response?: { transports?: unknown } }).response?.transports) ? (response as { response?: { transports?: string[] } }).response?.transports as never : undefined),
        device_type: verification.registrationInfo.credentialDeviceType,
        backed_up: verification.registrationInfo.credentialBackedUp,
      },
    });

    await prisma.user.update({
      where: { user_id: BigInt(Number(session.userId)) },
      data: { last_reverification_at: new Date() },
    });

    const createdSession = await createSession(
      {
        userId: session.userId,
        email: session.email,
        role: session.role,
      },
      false,
      ip,
      ua,
    );

    const next = NextResponse.json({
      message: "Passkey registered successfully.",
      session: createdSession.session,
    });

    next.cookies.set("reauth_state", "", getReauthStateCookieOptions(0));

    await logAuditEvent("WEBAUTHN_REGISTER_SUCCESS", Number(session.userId), ip, ua, { credentialId });
    return next;
  } catch (error) {
    console.error("[webauthn/register/verify] error:", error);
    await logAuditEvent("WEBAUTHN_REGISTER_VERIFY_ERROR", session?.userId, ip, ua, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
