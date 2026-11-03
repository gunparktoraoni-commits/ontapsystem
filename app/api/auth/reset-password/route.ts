// ──────────────────────────────────────────────────────────────
// POST /api/auth/reset-password — Password Reset Execution
// ──────────────────────────────────────────────────────────────
// Security:
// - Rate limited
// - Password strength validation
// - Revokes ALL existing sessions after password change
//   (forces re-authentication on all devices)
// - Resets account lockout counter
// - Audit logged
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { prismaAnalytics } from "@/server/lib/prisma-analytics";
import {
  validatePassword,
  revokeAllSessions,
  logAuditEvent,
  getClientIp,
  getUserAgent,
} from "@/server/lib/auth";
import { buildPasswordCredentialPayload } from "@/server/lib/password-vault";
import { validateResetPasswordInput } from "@/server/lib/validators";
import { checkRateLimit } from "@/server/lib/rate-limit";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  try {
    // ── Rate Limiting ──────────────────────────────
    const rateCheck = checkRateLimit("reset-password", ip);
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

    const validation = validateResetPasswordInput(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.errors[0] },
        { status: 400 }
      );
    }

    const { userId, password, confirmPassword } = validation.data;

    if (password !== confirmPassword) {
      return NextResponse.json(
        { error: "Passwords do not match." },
        { status: 400 }
      );
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return NextResponse.json(
        {
          error: "Password does not meet requirements.",
          details: passwordValidation.errors,
        },
        { status: 400 }
      );
    }

    // ── Find Credential ────────────────────────────
    const credential = await prisma.credential.findUnique({
      where: { user_id: BigInt(userId) },
    });

    if (!credential) {
      return NextResponse.json(
        { error: "User not found." },
        { status: 404 }
      );
    }

    // ── Update Password ────────────────────────────
    const passwordPayload = await buildPasswordCredentialPayload(password, "auth-reset-password");
    await prisma.credential.update({
      where: { credentials_id: credential.credentials_id },
      data: {
        password_hash: passwordPayload.password_hash,
        password_encrypted: passwordPayload.password_encrypted,
        password_changed_at: passwordPayload.password_changed_at,
        updated_at: passwordPayload.updated_at,
      },
    });

    // SECURITY: Revoke ALL sessions for this user.
    // After a password change, force re-authentication on every device.
    // This prevents a stolen session from persisting after password reset.
    await revokeAllSessions(userId);

    // Reset any account lockout (analytics DB may be optional in local dev)
    try {
      const analyticsAny = prismaAnalytics as unknown as any;
      if (analyticsAny?.accountLockout?.deleteMany) {
        await analyticsAny.accountLockout.deleteMany({
          where: { email: { in: [await getUserEmail(userId)] } },
        });
      }
    } catch (e) {
      // Non-fatal: analytics DB not available or operation failed
      console.warn("Analytics account lockout cleanup failed:", e);
    }

    await logAuditEvent("PASSWORD_RESET_SUCCESS", userId, ip, ua);

    return NextResponse.json(
      {
        message: "Password updated successfully. Please log in with your new password.",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Reset password error:", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}

/** Helper to get user email by ID for lockout cleanup */
async function getUserEmail(userId: number): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { user_id: BigInt(userId) },
    select: { email: true },
  });
  return user?.email ?? "";
}