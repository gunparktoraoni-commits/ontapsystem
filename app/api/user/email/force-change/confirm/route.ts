import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  resolveRequestSession,
  getClientIp,
  getUserAgent,
  verifyEmailOtp,
  logAuditEvent,
} from "@/server/lib/auth";
import {
  isForcedPlaceholderEmail,
  normalizeEmailAddress,
} from "@/lib/auth/placeholder-email";
import { cacheDel, cacheGet } from "@/lib/vcard/cache";
import { syncUserProfileToBizcard } from "@/lib/bizcard/sync";

function pendingEmailCacheKey(userId: number | bigint): string {
  return `force-email-change:pending:${userId.toString()}`;
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);
  const rl = checkRateLimit("verify-email", ip);
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

  const code =
    (typeof body.code === "string" && body.code.trim()) ||
    (typeof body.otp === "string" && body.otp.trim()) ||
    "";
  if (!code || code.length !== 6) {
    return NextResponse.json(
      { success: false, error: "Please enter the 6-character verification code." },
      { status: 422 },
    );
  }

  const userId = BigInt(resolved.session.userId);
  const user = await prisma.user.findUnique({
    where: { user_id: userId },
    select: { user_id: true, email: true, first_name: true, last_name: true },
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

  const pendingEmail = cacheGet<string>(pendingEmailCacheKey(userId));
  if (!pendingEmail || !normalizeEmailAddress(pendingEmail)) {
    return NextResponse.json(
      {
        success: false,
        error: "Your verification session expired. Please enter your new email again.",
        code: "PENDING_EMAIL_EXPIRED",
      },
      { status: 400 },
    );
  }

  const newEmail = normalizeEmailAddress(pendingEmail);

  const otpResult = await verifyEmailOtp(Number(userId), code, "force_email_change");
  if (otpResult === "expired") {
    return NextResponse.json(
      { success: false, error: "Verification code expired. Please request a new one.", code: "OTP_EXPIRED" },
      { status: 400 },
    );
  }
  if (otpResult === "max_attempts") {
    return NextResponse.json(
      {
        success: false,
        error: "Too many incorrect attempts. Please request a new verification code.",
        code: "OTP_MAX_ATTEMPTS",
      },
      { status: 400 },
    );
  }
  if (otpResult !== "verified") {
    return NextResponse.json(
      { success: false, error: "Invalid verification code. Please try again.", code: "OTP_INVALID" },
      { status: 400 },
    );
  }

  const conflict = await prisma.user.findFirst({
    where: {
      email: newEmail,
      user_id: { not: userId },
    },
    select: { user_id: true },
  });
  if (conflict) {
    cacheDel(pendingEmailCacheKey(userId));
    return NextResponse.json(
      { success: false, error: "That email address is already in use." },
      { status: 409 },
    );
  }

  const previousEmail = user.email;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { user_id: userId },
        data: {
          email: newEmail,
          updated_at: new Date(),
        },
      });
      await tx.credential.update({
        where: { user_id: userId },
        data: {
          email_verified: true,
          email_verified_at: new Date(),
          updated_at: new Date(),
        },
      });
    });
  } catch (error) {
    console.error("[user/email/force-change/confirm] update failed", error);
    return NextResponse.json(
      { success: false, error: "Failed to update email. Please try again." },
      { status: 500 },
    );
  }

  cacheDel(pendingEmailCacheKey(userId));

  try {
    await syncUserProfileToBizcard(userId);
  } catch (error) {
    console.error("[user/email/force-change/confirm] bizcard sync failed", error);
  }

  await logAuditEvent("FORCE_EMAIL_CHANGE_COMPLETED", Number(userId), ip, ua, {
    from_email: previousEmail,
    to_email: newEmail,
  });

  return NextResponse.json({
    success: true,
    message:
      "Your email/username was changed successfully. Please use your new email the next time you log in.",
    data: {
      email: newEmail,
      previous_email: previousEmail,
      verified_at: new Date().toISOString(),
    },
  });
}
