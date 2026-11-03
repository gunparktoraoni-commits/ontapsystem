import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  resolveRequestSession,
  getClientIp,
  getUserAgent,
  createEmailOtp,
  isValidEmail,
  logAuditEvent,
} from "@/server/lib/auth";
import { sendEmailVerificationOtp } from "@/server/lib/email";
import {
  isForcedPlaceholderEmail,
  normalizeEmailAddress,
} from "@/lib/auth/placeholder-email";
import { cacheSet } from "@/lib/vcard/cache";

const PENDING_EMAIL_TTL_SECONDS = 15 * 60;

function pendingEmailCacheKey(userId: number | bigint): string {
  return `force-email-change:pending:${userId.toString()}`;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);
  const rl = checkRateLimit("resend-otp", ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const resolved = await resolveRequestSession(request);
  if (!resolved.session) {
    return NextResponse.json(
      { success: false, error: "Authentication required.", requiresAuth: true },
      { status: 401 },
    );
  }

  if (resolved.impersonation) {
    return NextResponse.json(
      { success: false, error: "Email change is not available during impersonation." },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const rawNewEmail = typeof body.new_email === "string" ? body.new_email : "";
  const newEmail = normalizeEmailAddress(rawNewEmail);
  if (!newEmail || !isValidEmail(newEmail)) {
    return NextResponse.json(
      { success: false, error: "Please enter a valid email address." },
      { status: 422 },
    );
  }

  if (isForcedPlaceholderEmail(newEmail)) {
    return NextResponse.json(
      {
        success: false,
        error: "Please use your real email address. Temporary placeholder emails are not allowed.",
      },
      { status: 422 },
    );
  }

  const userId = BigInt(resolved.session.userId);
  const user = await prisma.user.findUnique({
    where: { user_id: userId },
    select: { user_id: true, email: true, first_name: true },
  });

  if (!user) {
    return NextResponse.json({ success: false, error: "User not found." }, { status: 404 });
  }

  if (!isForcedPlaceholderEmail(user.email)) {
    return NextResponse.json(
      { success: false, error: "Your account does not require a forced email change." },
      { status: 409 },
    );
  }

  if (normalizeEmailAddress(user.email) === newEmail) {
    return NextResponse.json(
      { success: false, error: "Please choose a different email address." },
      { status: 422 },
    );
  }

  const existing = await prisma.user.findFirst({
    where: {
      email: newEmail,
      user_id: { not: userId },
    },
    select: { user_id: true },
  });
  if (existing) {
    return NextResponse.json(
      { success: false, error: "That email address is already in use." },
      { status: 409 },
    );
  }

  const otp = await createEmailOtp(Number(userId), "force_email_change");
  cacheSet(pendingEmailCacheKey(userId), newEmail, PENDING_EMAIL_TTL_SECONDS);

  try {
    await sendEmailVerificationOtp(newEmail, user.first_name, otp, 10);
  } catch (error) {
    console.error("[user/email/force-change/request] email send failed", error);
    return NextResponse.json(
      { success: false, error: "Unable to send verification code. Please try again." },
      { status: 502 },
    );
  }

  await logAuditEvent("FORCE_EMAIL_CHANGE_OTP_SENT", Number(userId), ip, ua, {
    from_email: user.email,
    to_email: newEmail,
  });

  return NextResponse.json({
    success: true,
    message: "Verification code sent to your new email address.",
    data: {
      email: maskEmail(newEmail),
      expires_in: PENDING_EMAIL_TTL_SECONDS,
    },
  });
}
