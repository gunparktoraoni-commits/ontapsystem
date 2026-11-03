import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { prisma } from "@/server/lib/prisma";
import { createReverificationStateToken, getSession, logAuditEvent, parseReverificationStateToken, getReauthStateCookieOptions } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { resolveWebAuthnConfig } from "@/server/lib/webauthn";

export async function POST(request: NextRequest) {
  const session = await getSession();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ua = request.headers.get("user-agent") ?? "unknown";

  try {
    const rateCheck = checkRateLimit("webauthn-register-options", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    if (!session) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { user_id: BigInt(session.userId) },
      select: {
        user_id: true,
        email: true,
        first_name: true,
        last_name: true,
        webauthnCredentials: { select: { credential_id: true, transports: true } },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const { rpId } = resolveWebAuthnConfig(request.url);
    const options = await generateRegistrationOptions({
      rpName: "OnTap",
      rpID: rpId,
      userName: user.email,
      userID: Buffer.from(String(user.user_id)),
      userDisplayName: `${user.first_name} ${user.last_name}`.trim(),
      timeout: 60000,
      excludeCredentials: user.webauthnCredentials.map((credential) => ({
        id: credential.credential_id,
        type: "public-key" as const,
        transports: credential.transports ? credential.transports.split(",").filter(Boolean) as never : undefined,
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
    });

    const state = parseReverificationStateToken(request.cookies.get("reauth_state")?.value ?? "");
    const stateUserId = state?.userId ?? Number(session.userId);
    const stateEmail = state?.email ?? user.email;

    const response = NextResponse.json({
      options,
      user: {
        userId: Number(user.user_id),
        email: user.email,
        firstName: user.first_name,
      },
    });

    const nextState = createReverificationStateToken({
      userId: stateUserId,
      email: stateEmail,
      purpose: "webauthn_register",
      challenge: options.challenge,
    });

    response.cookies.set("reauth_state", nextState.token, getReauthStateCookieOptions(15 * 60));

    await logAuditEvent("WEBAUTHN_REGISTER_OPTIONS", Number(user.user_id), ip, ua);
    return response;
  } catch (error) {
    console.error("[webauthn/register/options] error:", error);
    await logAuditEvent("WEBAUTHN_REGISTER_OPTIONS_ERROR", session?.userId, ip, ua, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
