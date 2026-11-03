import { NextRequest, NextResponse } from "next/server";
import { VerificationService } from "@/lib/services/verificationService";
import { rateLimit } from "@/lib/middleware/rateLimit";

const emailRegex = /^[^\s@]+@([^\s@]+\.)+[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "MISSING_EMAIL",
            message: "Email address is required",
          },
        },
        { status: 400 }
      );
    }

    if (!emailRegex.test(email)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_EMAIL",
            message: "Please provide a valid email address",
          },
        },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    const rl = await rateLimit({
      key: `resend-verification:${normalizedEmail}`,
      window: 3600,
      limit: 3,
    });

    if (!rl.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many resend attempts. Please try again later.",
            retryAfter: rl.retryAfter,
          },
        },
        { status: 429, headers: rl.retryAfter ? { "Retry-After": String(rl.retryAfter) } : undefined }
      );
    }

    const verificationService = VerificationService.getInstance();
    const result = await verificationService.resendVerification(normalizedEmail);

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: "Verification code resent successfully",
        data: {
          email: normalizedEmail,
          expiresIn: 15,
        },
      });
    }

    const errorMap = {
      RATE_LIMIT_EXCEEDED: {
        status: 429,
        code: "RATE_LIMIT_EXCEEDED",
        message: `Please wait ${result.cooldownRemaining || 60} seconds before requesting another code.`,
      },
      USER_NOT_FOUND: {
        status: 404,
        code: "USER_NOT_FOUND",
        message: "No account found with this email address.",
      },
      ALREADY_VERIFIED: {
        status: 400,
        code: "ALREADY_VERIFIED",
        message: "This email is already verified. You can log in now.",
      },
      EMAIL_SEND_FAILED: {
        status: 502,
        code: "EMAIL_SEND_FAILED",
        message: "Failed to send verification email. Please try again later.",
      },
    } as const;

    const mapped = errorMap[(result.error || "EMAIL_SEND_FAILED") as keyof typeof errorMap] || errorMap.EMAIL_SEND_FAILED;

    return NextResponse.json(
      {
        success: false,
        error: {
          code: mapped.code,
          message: mapped.message,
        },
      },
      {
        status: mapped.status,
        headers: result.cooldownRemaining
          ? { "Retry-After": String(result.cooldownRemaining) }
          : undefined,
      }
    );
  } catch (error) {
    console.error("Resend verification error:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SERVER_ERROR",
          message: "Failed to resend verification code. Please try again later.",
        },
      },
      { status: 500 }
    );
  }
}
