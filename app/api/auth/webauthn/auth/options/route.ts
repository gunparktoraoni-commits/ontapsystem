import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { prisma } from "@/server/lib/prisma";
import {
  createReverificationStateToken,
  getClientIp,
  getUserAgent,
  logAuditEvent,
  parseReverificationStateToken,
  getReauthStateCookieOptions,
} from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { parseTransports, resolveWebAuthnConfig } from "@/server/lib/webauthn";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  try {
    const rateCheck = checkRateLimit("webauthn-auth-options", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    const stateToken = request.cookies.get("reauth_state")?.value;
    const state = stateToken ? parseReverificationStateToken(stateToken) : null;
    if (!state || state.purpose !== "otp_reauth") {
      return NextResponse.json({ error: "Verification required." }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { user_id: BigInt(state.userId) },
      select: {
        user_id: true,
        email: true,
        first_name: true,
        webauthnCredentials: {
          select: { credential_id: true, transports: true },
        },
      },
    });

    if (!user || user.email.toLowerCase() !== state.email.toLowerCase()) {
      await logAuditEvent("WEBAUTHN_AUTH_OPTIONS_USER_NOT_FOUND", state.userId, ip, ua);
      return NextResponse.json({ error: "Verification required." }, { status: 404 });
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
    });

    const nextState = createReverificationStateToken({
      userId: Number(user.user_id),
      email: user.email,
      purpose: "webauthn_auth",
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

    return response;
  } catch (error) {
    console.error("[webauthn/auth/options] error:", error);
    await logAuditEvent("WEBAUTHN_AUTH_OPTIONS_ERROR", undefined, ip, ua, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
