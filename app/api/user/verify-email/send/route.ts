import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  resolveRequestSession,
  getClientIp,
  createEmailOtp,
  isValidEmail,
} from "@/server/lib/auth";
import { sendEmailVerificationOtp } from "@/server/lib/email";

const OTP_EXPIRY_SECONDS = 10 * 60;
const RESEND_COOLDOWN_SECONDS = 60;

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

async function requireSession(request: NextRequest) {
  const resolved = await resolveRequestSession(request);
  if (!resolved.session) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          success: false,
          error: "Authentication required.",
          requiresAuth: true,
        },
        { status: 401 },
      ),
    };
  }
  return { ok: true as const, session: resolved.session };
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = checkRateLimit("resend-otp", ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many requests." },
      { status: 429 },
    );
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const userId = BigInt(auth.session.userId);
  const user = await prisma.user.findUnique({
    where: { user_id: userId },
    select: { first_name: true, email: true },
  });
  if (!user) {
    return NextResponse.json(
      { success: false, error: "User not found." },
      { status: 404 },
    );
  }

  const requestedEmail =
    typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : user.email;
  if (!isValidEmail(requestedEmail)) {
    return NextResponse.json(
      { success: false, error: "Invalid email." },
      { status: 422 },
    );
  }

  const otp = await createEmailOtp(Number(userId));
  try {
    await sendEmailVerificationOtp(
      requestedEmail,
      user.first_name,
      otp,
      OTP_EXPIRY_SECONDS / 60,
    );
  } catch (error) {
    console.error("[user/verify-email/send] email failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to send verification email. Please try again later.",
        code: "EMAIL_SEND_FAILED",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    success: true,
    message: "Verification email sent",
    data: {
      email: maskEmail(requestedEmail),
      expires_in: OTP_EXPIRY_SECONDS,
      resend_allowed_at: new Date(
        Date.now() + RESEND_COOLDOWN_SECONDS * 1000,
      ).toISOString(),
    },
  });
}
