import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  resolveRequestSession,
  getClientIp,
  getUserAgent,
  validatePassword,
  logAuditEvent,
} from "@/server/lib/auth";
import { buildPasswordCredentialPayload } from "@/server/lib/password-vault";
import { withPerformanceTracking } from "@/middleware/performance";

/**
 * POST /api/user/password/force-change
 *
 * Used after a superadmin password reset when must_change_password is true.
 * Caller is already authenticated with the temporary password — only a new
 * password + confirmation are required.
 */
export async function POST(request: NextRequest) {
  return withPerformanceTracking(request, async () => {
    const ip = getClientIp(request);
    const ua = getUserAgent(request);

    const rl = checkRateLimit("reset-password", ip);
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: "Too many attempts." }, { status: 429 });
    }

    const auth = await resolveRequestSession(request);
    if (!auth.session) {
      return NextResponse.json(
        { success: false, error: "Authentication required.", requiresAuth: true },
        { status: 401 },
      );
    }

    // Impersonation must not satisfy a forced password change for the target.
    if (auth.impersonation) {
      return NextResponse.json(
        { success: false, error: "Password change is not available during impersonation." },
        { status: 403 },
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
    }

    const newPassword = typeof body.new_password === "string" ? body.new_password : "";
    const confirmPassword = typeof body.confirm_password === "string" ? body.confirm_password : "";

    if (!newPassword || !confirmPassword) {
      return NextResponse.json(
        { success: false, error: "New password and confirmation are required." },
        { status: 422 },
      );
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { success: false, error: "Password confirmation does not match." },
        { status: 422 },
      );
    }

    const policy = validatePassword(newPassword);
    if (!policy.valid) {
      return NextResponse.json(
        { success: false, error: "Password policy failed.", details: policy.errors },
        { status: 422 },
      );
    }

    const userId = BigInt(auth.session.userId);
    const credential = await prisma.credential.findUnique({
      where: { user_id: userId },
      select: {
        credentials_id: true,
        password_hash: true,
        must_change_password: true,
      },
    });

    if (!credential) {
      return NextResponse.json({ success: false, error: "Credential not found." }, { status: 404 });
    }

    if (!credential.must_change_password) {
      return NextResponse.json(
        { success: false, error: "A forced password change is not required for this account." },
        { status: 400 },
      );
    }

    const passwordPayload = await buildPasswordCredentialPayload(
      newPassword,
      "user-force-password-change",
    );

    await prisma.credential.update({
      where: { credentials_id: credential.credentials_id },
      data: {
        password_hash: passwordPayload.password_hash,
        password_encrypted: passwordPayload.password_encrypted,
        password_changed_at: passwordPayload.password_changed_at,
        must_change_password: false,
        updated_at: passwordPayload.updated_at,
      },
    });

    await logAuditEvent("USER_FORCED_PASSWORD_CHANGED", Number(userId), ip, ua, {
      reason: "must_change_password",
    });

    return NextResponse.json({
      success: true,
      message: "Password updated successfully.",
      data: { requiresPasswordChange: false },
    });
  });
}
