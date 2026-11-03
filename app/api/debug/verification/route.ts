import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";

export async function GET(req: NextRequest) {
  const isDev = process.env.NODE_ENV !== "production";
  const debugSecret = process.env.DEBUG_VERIFICATION_SECRET;
  const provided = req.headers.get("x-debug-secret") || "";

  if (!isDev && (!debugSecret || provided !== debugSecret)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const email = (searchParams.get("email") || "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Email query parameter is required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { user_id: true },
  });

  if (!user) {
    return NextResponse.json({ email, activeVerifications: [] });
  }

  const verifications = await prisma.emailOtp.findMany({
    where: { user_id: user.user_id },
    orderBy: { expires_at: "desc" },
    take: 5,
    select: {
      id: true,
      attempts: true,
      used: true,
      created_at: true,
      expires_at: true,
      otp_hash: true,
    },
  });

  return NextResponse.json({
    email,
    userId: Number(user.user_id),
    activeVerifications: verifications.map((v) => ({
      id: Number(v.id),
      hashPreview: `${v.otp_hash.slice(0, 8)}...`,
      attempts: v.attempts,
      used: v.used,
      createdAt: v.created_at,
      expiresAt: v.expires_at,
      isValid: !v.used && v.expires_at > new Date(),
    })),
  });
}
