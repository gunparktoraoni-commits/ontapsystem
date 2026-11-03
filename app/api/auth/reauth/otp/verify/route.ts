import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { createSession, getClientIp, getUserAgent, logAuditEvent, parseReverificationStateToken, verifyEmailOtp, getReauthStateCookieOptions } from "@/server/lib/auth";
import { ensureAliasLockStarted } from "@/lib/bizcard/url-alias-utils";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  try {
    const rateCheck = checkRateLimit("reauth-otp-verify", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    const state = parseReverificationStateToken(request.cookies.get("reauth_state")?.value ?? "");
    if (!state || state.purpose !== "otp_reauth") {
      return NextResponse.json({ error: "Verification required." }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code || code.length !== 6) {
      return NextResponse.json({ error: "Verification code is required." }, { status: 400 });
    }

    const result = await verifyEmailOtp(state.userId, code, "otp_reauth");
    if (result !== "verified") {
      await logAuditEvent("REAUTH_OTP_INVALID", state.userId, ip, ua, { result });
      return NextResponse.json({ error: "Invalid or expired verification code." }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { user_id: BigInt(state.userId) },
      select: {
        user_id: true,
        email: true,
        first_name: true,
        last_name: true,
        role: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    await prisma.user.update({
      where: { user_id: user.user_id },
      data: { last_reverification_at: new Date() },
    });

    const createdSession = await createSession(
      {
        userId: Number(user.user_id),
        email: user.email,
        role: user.role,
      },
      false,
      ip,
      ua,
    );

    // Stamp 90-day alias lock for migrated users (login may have returned REVERIFICATION_REQUIRED before stamping).
    try {
      await ensureAliasLockStarted(user.user_id);
    } catch (aliasLockError) {
      console.error("[reauth/otp/verify] Failed to ensure alias lock:", aliasLockError);
    }

    const response = NextResponse.json({
      message: "Verification successful.",
      user: {
        userId: Number(user.user_id),
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
      },
      session: createdSession.session,
    });

    response.cookies.set("reauth_state", "", getReauthStateCookieOptions(0));

    await logAuditEvent("REAUTH_OTP_SUCCESS", state.userId, ip, ua);
    return response;
  } catch (error) {
    console.error("[reauth/otp/verify] error:", error);
    await logAuditEvent("REAUTH_OTP_VERIFY_ERROR", undefined, ip, ua, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
