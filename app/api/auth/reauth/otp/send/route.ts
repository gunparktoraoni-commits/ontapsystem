import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { createEmailOtp, getClientIp, getUserAgent, logAuditEvent, parseReverificationStateToken } from "@/server/lib/auth";
import { EmailService } from "@/lib/services/emailService";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  try {
    const rateCheck = checkRateLimit("reauth-otp-send", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    const state = parseReverificationStateToken(request.cookies.get("reauth_state")?.value ?? "");
    if (!state) {
      return NextResponse.json({ error: "Verification required." }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { user_id: BigInt(state.userId) },
      select: { email: true, first_name: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const otp = await createEmailOtp(state.userId, "otp_reauth");
    const emailService = EmailService.getInstance();
    const sent = await emailService.sendVerificationEmail({
      email: user.email,
      code: otp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    if (!sent.success) {
      await logAuditEvent("REAUTH_OTP_SEND_FAILED", state.userId, ip, ua, { error: sent.error ?? "Unknown error" });
      return NextResponse.json({ error: "Failed to send verification code." }, { status: 502 });
    }

    await logAuditEvent("REAUTH_OTP_SENT", state.userId, ip, ua);
    return NextResponse.json({
      message: "Verification code sent.",
      email: user.email.replace(/^(.{2})(.*)(@.*)$/, (_, a, b, c) => `${a}${"*".repeat(Math.max(1, b.length))}${c}`),
    });
  } catch (error) {
    console.error("[reauth/otp/send] error:", error);
    await logAuditEvent("REAUTH_OTP_SEND_ERROR", undefined, ip, ua, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
