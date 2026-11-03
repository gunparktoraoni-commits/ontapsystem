import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  resolveRequestSession,
  resolveEffectiveUserId,
  getClientIp,
  getUserAgent,
  verifyPassword,
  validatePassword,
  revokeAllSessions,
  createSession,
  logAuditEvent,
} from "@/server/lib/auth";
import { sendEmailMessage } from "@/server/lib/email";
import { withPerformanceTracking } from "@/middleware/performance";

async function requireSession(request: NextRequest) {
  const resolved = await resolveRequestSession(request);
  if (!resolved.session) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Authentication required.", requiresAuth: true }, { status: 401 }),
    };
  }
  return {
    ok: true as const,
    session: resolved.session,
    refreshed: resolved.refreshed,
    impersonation: resolved.impersonation,
    companyActing: resolved.companyActing,
    requiresReverification: resolved.requiresReverification,
  };
}

export async function POST(request: NextRequest) {
  return withPerformanceTracking(request, async () => {
    const ip = getClientIp(request);
    const ua = getUserAgent(request);

    const rl = checkRateLimit("reset-password", ip);
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: "Too many attempts." }, { status: 429 });
    }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const currentPassword = typeof body.current_password === "string" ? body.current_password : "";
  const newPassword = typeof body.new_password === "string" ? body.new_password : "";
  const confirmPassword = typeof body.confirm_password === "string" ? body.confirm_password : "";

  if (!currentPassword || !newPassword || !confirmPassword) {
    return NextResponse.json({ success: false, error: "Missing required password fields." }, { status: 422 });
  }

  if (newPassword !== confirmPassword) {
    return NextResponse.json({ success: false, error: "confirm_password must match new_password." }, { status: 422 });
  }

  if (newPassword === currentPassword) {
    return NextResponse.json({ success: false, error: "New password must be different from current password." }, { status: 422 });
  }

  const policy = validatePassword(newPassword);
  if (!policy.valid) {
    return NextResponse.json({ success: false, error: "Password policy failed.", details: policy.errors }, { status: 422 });
  }

  const effectiveUserId = resolveEffectiveUserId(auth);
  const userId = BigInt(effectiveUserId);

  const credential = await prisma.credential.findUnique({
    where: { user_id: userId },
    select: { credentials_id: true, password_hash: true },
  });

  if (!credential) {
    return NextResponse.json({ success: false, error: "Credential not found." }, { status: 404 });
  }

  const matches = await verifyPassword(currentPassword, credential.password_hash);
  if (!matches) {
    await logAuditEvent("USER_PASSWORD_CHANGE_FAILED", Number(userId), ip, ua, { reason: "invalid_current_password" });
    return NextResponse.json({ success: false, error: "Current password is incorrect." }, { status: 401 });
  }

  const { buildPasswordCredentialPayload } = await import("@/server/lib/password-vault");
  const passwordPayload = await buildPasswordCredentialPayload(newPassword, "user-password-change");

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

  await revokeAllSessions(Number(userId));

  await createSession(
    {
      userId: Number(userId),
      email: auth.session.email,
      role: auth.session.role,
    },
    auth.session.rememberMe,
    ip,
    ua
  );

  try {
    await sendEmailMessage({
      to: auth.session.email,
      subject: "Password changed successfully",
      html: "<p>Your account password was changed successfully.</p>",
      text: "Your account password was changed successfully.",
    });
  } catch (error) {
    console.error("[user/password/change] confirmation email failed", error);
  }

    await logAuditEvent("USER_PASSWORD_CHANGED", Number(userId), ip, ua);

    return NextResponse.json({
      success: true,
      message: "Password changed successfully",
      data: {
        changed_at: new Date().toISOString(),
        sessions_affected: {
          current_session: "kept",
          other_sessions: "invalidated",
        },
        next_steps: ["Use new password on next login", "Check email for confirmation"],
      },
    });
  });
}
