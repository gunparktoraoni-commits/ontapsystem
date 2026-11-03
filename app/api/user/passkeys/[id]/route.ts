import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getSession, logAuditEvent } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

/**
 * DELETE /api/user/passkeys/[id]
 * 
 * Removes a specific WebAuthn credential from the user's account.
 * The user must have at least one remaining credential or a password to prevent lockout.
 * 
 * Security:
 * - Requires active session
 * - Validates credential ownership
 * - Prevents deletion of last authentication method
 * - Logs deletion for audit trail
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ua = request.headers.get("user-agent") ?? "unknown";

  let credentialId = '';

  try {
    const rateCheck = checkRateLimit("passkey-delete", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    if (!session) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const { id } = await params;
    credentialId = id;
    if (!credentialId) {
      return NextResponse.json({ error: "Credential ID is required." }, { status: 400 });
    }

    // Find the credential and verify ownership
    const credential = await prisma.webAuthnCredential.findFirst({
      where: {
        credential_id: credentialId,
        user_id: BigInt(session.userId),
      },
      select: {
        id: true,
        credential_id: true,
        credential_name: true,
      },
    });

    if (!credential) {
      return NextResponse.json(
        { error: "Passkey not found or you do not have permission to delete it." },
        { status: 404 }
      );
    }

    // Check if this is the user's last authentication method
    // Count remaining passkeys (excluding the one being deleted)
    const remainingPasskeys = await prisma.webAuthnCredential.count({
      where: {
        user_id: BigInt(session.userId),
        credential_id: { not: credentialId },
      },
    });

    // Check if user has a password set
    const user = await prisma.user.findUnique({
      where: { user_id: BigInt(session.userId) },
      select: {
        credentials: {
          select: { password_hash: true },
        },
      },
    });

    const hasPassword = Boolean(user?.credentials?.password_hash);

    // Prevent deletion if this is the last auth method
    if (remainingPasskeys === 0 && !hasPassword) {
      return NextResponse.json(
        {
          error:
            "Cannot delete your last passkey. Please set a password first or add another passkey before removing this one.",
          code: "LAST_AUTH_METHOD",
        },
        { status: 400 }
      );
    }

    // Delete the credential
    await prisma.webAuthnCredential.delete({
      where: { credential_id: credentialId },
    });

    await logAuditEvent("PASSKEY_DELETED", session.userId, ip, ua, {
      credentialId,
      credentialName: credential.credential_name,
    });

    return NextResponse.json({
      success: true,
      message: "Passkey removed successfully.",
    });
  } catch (error) {
    console.error("[passkeys/delete] error:", error);
    await logAuditEvent("PASSKEY_DELETE_ERROR", session?.userId, ip, ua, {
      error: error instanceof Error ? error.message : "Unknown error",
      credentialId,
    });
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
