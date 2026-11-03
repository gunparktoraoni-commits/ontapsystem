import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { resolveRequestSession, getClientIp, verifyEmailOtp } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";

async function requireSession(request: NextRequest) {
  const resolved = await resolveRequestSession(request);
  if (!resolved.session) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Authentication required.", requiresAuth: true }, { status: 401 }),
    };
  }
  return { ok: true as const, session: resolved.session };
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = checkRateLimit("verify-email", ip);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429 });
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const candidate = code || token;

  if (!candidate) {
    return NextResponse.json({ success: false, error: "Missing token or code." }, { status: 422 });
  }

  const userId = Number(auth.session.userId);
  const result = await verifyEmailOtp(userId, candidate);
  if (result !== "verified") {
    return NextResponse.json({ success: false, error: "Invalid or expired verification token." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { user_id: BigInt(userId) }, select: { email: true } });

  return NextResponse.json({
    success: true,
    message: "Email verified successfully",
    data: {
      email: user?.email ?? auth.session.email,
      verified_at: new Date().toISOString(),
    },
  });
}
