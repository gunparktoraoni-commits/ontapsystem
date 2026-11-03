import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, validatePassword, verifyCode, revokeAllSessions, logAuditEvent } from "@/server/lib/auth";
import { buildPasswordCredentialPayload } from "@/server/lib/password-vault";
import { withPerformanceTracking } from "@/middleware/performance";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function POST(request: NextRequest) {
  return withPerformanceTracking(request, async () => {
    const ip = getClientIp(request);
    const rl = checkRateLimit("reset-password", ip);
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: "Too many attempts." }, { status: 429 });
    }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const newPassword = typeof body.new_password === "string" ? body.new_password : "";
  const confirmPassword = typeof body.confirm_password === "string" ? body.confirm_password : "";

  if (!token || !newPassword || !confirmPassword) {
    return NextResponse.json({ success: false, error: "Missing required fields." }, { status: 422 });
  }

  if (newPassword !== confirmPassword) {
    return NextResponse.json({ success: false, error: "confirm_password must match new_password." }, { status: 422 });
  }

  const policy = validatePassword(newPassword);
  if (!policy.valid) {
    return NextResponse.json({ success: false, error: "Password policy failed.", details: policy.errors }, { status: 422 });
  }

  const now = new Date();
  const tokenHash = hashToken(token.toUpperCase());
  let userId: number | null = null;
  let passwordResetTokenId: bigint | null = null;

  const resetRows = await prisma.$queryRaw<Array<{ id: bigint; user_id: bigint }>>`
    SELECT id, user_id
    FROM PasswordResetToken
    WHERE token_hash = ${tokenHash}
      AND used_at IS NULL
      AND expires_at > ${now}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const resetRecord = resetRows[0] ?? null;

  if (resetRecord) {
    userId = Number(resetRecord.user_id);
    passwordResetTokenId = resetRecord.id;
  } else {
    const [userIdRaw, legacyCode] = token.split(":");
    if (!userIdRaw || !legacyCode || !/^\d+$/.test(userIdRaw)) {
      return NextResponse.json({ success: false, error: "Invalid or expired reset token." }, { status: 400 });
    }

    const legacyUserId = Number(userIdRaw);
    const ok = await verifyCode(legacyUserId, legacyCode);
    if (!ok) {
      return NextResponse.json({ success: false, error: "Invalid or expired reset token." }, { status: 400 });
    }
    userId = legacyUserId;
  }

  if (!userId) {
    return NextResponse.json({ success: false, error: "Invalid or expired reset token." }, { status: 400 });
  }

  const credential = await prisma.credential.findUnique({ where: { user_id: BigInt(userId) }, select: { credentials_id: true } });
  if (!credential) {
    return NextResponse.json({ success: false, error: "Credential not found." }, { status: 404 });
  }

  const passwordPayload = await buildPasswordCredentialPayload(newPassword, "user-password-reset");
  await prisma.$transaction(async (tx) => {
    await tx.credential.update({
      where: { credentials_id: credential.credentials_id },
      data: {
        password_hash: passwordPayload.password_hash,
        password_encrypted: passwordPayload.password_encrypted,
        password_changed_at: passwordPayload.password_changed_at,
        updated_at: passwordPayload.updated_at,
      },
    });

    if (passwordResetTokenId !== null) {
      await tx.$executeRaw`
        UPDATE PasswordResetToken
        SET used_at = ${new Date()}
        WHERE id = ${passwordResetTokenId}
      `;
    }

    await tx.$executeRaw`
      UPDATE PasswordResetToken
      SET used_at = ${new Date()}
      WHERE user_id = ${BigInt(userId)} AND used_at IS NULL
    `;
  });

    await revokeAllSessions(userId);
    await logAuditEvent("USER_PASSWORD_RESET", userId, ip, undefined);

    return NextResponse.json({
      success: true,
      message: "Password reset successfully",
      data: {
        reset_at: new Date().toISOString(),
        next_steps: ["Login with new password", "Check email for confirmation"],
      },
    });
  });
}
