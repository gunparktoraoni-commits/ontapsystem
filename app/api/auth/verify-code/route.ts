// ──────────────────────────────────────────────────────────────
// POST /api/auth/verify-code — Verification Code Validation
// ──────────────────────────────────────────────────────────────
// Security:
// - Rate limited to prevent code brute-force
// - Code is single-use (marked as used after verification)
// - Code expires after 10 minutes
// - Case-insensitive comparison
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import {
  verifyCode,
  logAuditEvent,
  getClientIp,
  getUserAgent,
} from "@/server/lib/auth";
import { validateVerifyCodeInput } from "@/server/lib/validators";
import { checkRateLimit } from "@/server/lib/rate-limit";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  try {
    // ── Rate Limiting ──────────────────────────────
    const rateCheck = checkRateLimit("verify-code", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    // ── Parse & Validate ───────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      );
    }

    const validation = validateVerifyCodeInput(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.errors[0] },
        { status: 400 }
      );
    }

    const { userId, code } = validation.data;

    const isValid = await verifyCode(userId, code);

    if (!isValid) {
      await logAuditEvent("VERIFY_CODE_FAILED", userId, ip, ua);

      return NextResponse.json(
        { error: "Invalid or expired verification code." },
        { status: 400 }
      );
    }

    await logAuditEvent("VERIFY_CODE_SUCCESS", userId, ip, ua);

    return NextResponse.json(
      {
        message: "Code verified successfully. You may now reset your password.",
        verified: true,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Verify code error:", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
