import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getSession, logAuditEvent } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

/**
 * GET /api/user/passkeys
 * 
 * Returns a list of all WebAuthn credentials enrolled for the current user.
 * Each credential includes device information, last used timestamp, and backup status.
 * 
 * Security:
 * - Requires active session
 * - Rate limited to prevent enumeration
 * - Returns only user's own credentials
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ua = request.headers.get("user-agent") ?? "unknown";

  try {
    const rateCheck = checkRateLimit("passkey-list", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    if (!session) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const credentials = await prisma.webAuthnCredential.findMany({
      where: { user_id: BigInt(session.userId) },
      select: {
        id: true,
        credential_id: true,
        credential_name: true,
        device_type: true,
        backed_up: true,
        transports: true,
        last_used_at: true,
        created_at: true,
      },
      orderBy: { created_at: "desc" },
    });

    const serializedCredentials = credentials.map((cred) => ({
      id: Number(cred.id),
      credentialId: cred.credential_id,
      credentialName: cred.credential_name || `Passkey ${new Date(cred.created_at).toLocaleDateString()}`,
      deviceType: cred.device_type,
      backedUp: cred.backed_up,
      transports: cred.transports ? cred.transports.split(",") : [],
      lastUsedAt: cred.last_used_at?.toISOString() ?? null,
      createdAt: cred.created_at.toISOString(),
    }));

    return NextResponse.json({
      success: true,
      data: { credentials: serializedCredentials },
    });
  } catch (error) {
    console.error("[passkeys/list] error:", error);
    await logAuditEvent("PASSKEY_LIST_ERROR", session?.userId, ip, ua, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
