import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, isValidEmail, logAuditEvent } from "@/server/lib/auth";
import { sendVerificationEmail } from "@/server/lib/email";

const RESET_TOKEN_BYTES = 18; // 36-hex token, easier to type than 64 while remaining high-entropy
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000;

function createResetToken(): string {
  return crypto.randomBytes(RESET_TOKEN_BYTES).toString("hex").toUpperCase();
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = checkRateLimit("forgot-password", ip);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!isValidEmail(email)) {
    return NextResponse.json({ success: true, message: "If an account exists with this email, you will receive password reset instructions" }, { status: 200 });
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { user_id: true, email: true } });
  if (user) {
    const token = createResetToken();
    const tokenHash = hashToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RESET_TOKEN_EXPIRY_MS);

    await prisma.$executeRaw`
      UPDATE PasswordResetToken
      SET used_at = ${now}
      WHERE user_id = ${user.user_id} AND used_at IS NULL
    `;

    await prisma.$executeRaw`
      INSERT INTO PasswordResetToken
      (user_id, token_hash, requested_ip, requested_user_agent, expires_at, created_at)
      VALUES
      (${user.user_id}, ${tokenHash}, ${ip}, ${request.headers.get("user-agent")?.slice(0, 512) ?? null}, ${expiresAt}, ${now})
    `;

    try {
      await sendVerificationEmail(user.email, token, 60);
    } catch (error) {
      console.error("[user/password/forgot] email send failed", error);
    }
    await logAuditEvent("USER_PASSWORD_FORGOT_REQUEST", Number(user.user_id), ip, undefined);
  }

  return NextResponse.json({
    success: true,
    message: "If an account exists with this email, you will receive password reset instructions",
    data: {
      email: maskEmail(email),
      expires_in: 3600,
    },
  });
}
