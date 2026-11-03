import { NextRequest, NextResponse } from "next/server";
import { VerificationService } from "@/lib/services/verificationService";

const emailRegex = /^[^\s@]+@([^\s@]+\.)+[^\s@]+$/;
const codeRegex = /^\d{6}$/;

export async function POST(req: NextRequest) {
  try {
    const { email, code } = await req.json();

    if (!email || !code) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "MISSING_FIELDS",
            message: "Email and verification code are required",
          },
        },
        { status: 400 }
      );
    }

    if (typeof email !== "string" || !emailRegex.test(email)) {
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

    if (typeof code !== "string" || !codeRegex.test(code)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_CODE_FORMAT",
            message: "Verification code must be 6 digits",
          },
        },
        { status: 400 }
      );
    }

    const verificationService = VerificationService.getInstance();
    const result = await verificationService.validateCode(email, code);

    if (result.valid) {
      return NextResponse.json({
        success: true,
        message: "Email verified successfully",
        data: {
          email: email.toLowerCase(),
          verifiedAt: new Date().toISOString(),
        },
      });
    }

    const errorResponses = {
      NO_ACTIVE_CODE: {
        status: 404,
        code: "NO_ACTIVE_VERIFICATION",
        message: "No active verification code found. Please request a new code.",
      },
      MAX_ATTEMPTS_EXCEEDED: {
        status: 429,
        code: "MAX_ATTEMPTS_EXCEEDED",
        message: "Too many failed attempts. Please request a new verification code.",
      },
      INVALID_CODE: {
        status: 401,
        code: "INVALID_CODE",
        message: "Invalid verification code. Please try again.",
      },
      USER_NOT_FOUND: {
        status: 404,
        code: "USER_NOT_FOUND",
        message: "No account found with this email address.",
      },
      ALREADY_VERIFIED: {
        status: 400,
        code: "ALREADY_VERIFIED",
        message: "This email is already verified.",
      },
    } as const;

    const mapped = errorResponses[(result.error || "INVALID_CODE") as keyof typeof errorResponses] || errorResponses.INVALID_CODE;

    return NextResponse.json(
      {
        success: false,
        error: {
          code: mapped.code,
          message: mapped.message,
          shouldReset: result.shouldReset,
        },
      },
      { status: mapped.status }
    );
  } catch (error) {
    console.error("Verification error:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SERVER_ERROR",
          message: "An error occurred during verification. Please try again later.",
        },
      },
      { status: 500 }
    );
  }
}
