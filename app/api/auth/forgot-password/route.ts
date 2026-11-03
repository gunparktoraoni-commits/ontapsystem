import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import {
  isValidEmail,
  createVerificationCode,
  logAuditEvent,
  getClientIp,
  getUserAgent,
} from "@/server/lib/auth";
import { sendVerificationEmail } from "@/server/lib/email";
import { validateForgotPasswordInput } from "@/server/lib/validators";
import { checkRateLimit } from "@/server/lib/rate-limit";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  try {
    const rateCheck = checkRateLimit("forgot-password", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      );
    }

    const validation = validateForgotPasswordInput(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.errors[0] },
        { status: 400 }
      );
    }

    const { email } = validation.data;

    if (!isValidEmail(email)) {
      return NextResponse.json(
        { error: "Please provide a valid email address." },
        { status: 400 }
      );
    }

    const successMessage = "If an account with that email exists, a verification code has been sent.";

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      await logAuditEvent("FORGOT_PASSWORD_UNKNOWN_EMAIL", undefined, ip, ua, { email });

      return NextResponse.json(
        { message: successMessage },
        { status: 200 }
      );
    }

    const code = await createVerificationCode(Number(user.user_id));

    try {
      await sendVerificationEmail(user.email, code);
    } catch (emailError) {
      console.error("Failed to send verification email: ", emailError);
    }

    await logAuditEvent("FORGOT_PASSWORD_CODE_SENT", Number(user.user_id), ip, ua);

    return NextResponse.json(
      {
        message: successMessage,
        userId: Number(user.user_id),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Forgot password error: ", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}