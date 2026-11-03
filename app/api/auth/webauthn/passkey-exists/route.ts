import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp, getUserAgent, logAuditEvent } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

// ──────────────────────────────────────────────────────────────
// GET /api/auth/webauthn/passkey-exists
// ──────────────────────────────────────────────────────────────
// Lightweight pre-authentication endpoint that checks whether a
// given email address has any enrolled WebAuthn credentials in
// the database.
//
// This is called from the login page on mount to determine
// whether to show the biometric prompt, WITHOUT generating a
// challenge or mutating any server state.  It is intentionally
// minimal — a full options request (POST /login/options) is only
// made once the user actually attempts biometric authentication.
//
// Security:
// - Accepts email only as a query parameter (GET, read-only)
// - IP rate limited (20 requests per 15 minutes)
// - Returns the same { hasPasskey: false } response for unknown
//   emails to prevent user-existence enumeration.  Only a
//   deactivated-account error leaks that the account exists, but
//   that is intentional (mirrors the login endpoint behaviour).
// - No challenge is generated; no cookie is set.
// - No authentication required (pre-login flow).
//
// Usage:
//   GET /api/auth/webauthn/passkey-exists?email=user%40example.com
//
// Response:
//   200 { hasPasskey: true  }  — user exists and has ≥1 credential
//   200 { hasPasskey: false }  — user not found, deactivated, or no credentials
//   400 { error: "..." }       — missing or malformed email parameter
//   429 { error: "..." }       — rate limit exceeded
//   500 { error: "..." }       — internal server error
// ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  try {
    // ── Rate limit ────────────────────────────────────────────
    const rateCheck = checkRateLimit("webauthn-passkey-exists", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        { status: 429 }
      );
    }

    // ── Input validation ──────────────────────────────────────
    const rawEmail = request.nextUrl.searchParams.get("email");
    if (!rawEmail || typeof rawEmail !== "string") {
      return NextResponse.json(
        { error: "email query parameter is required." },
        { status: 400 }
      );
    }

    const email = rawEmail.trim().toLowerCase();

    // Basic structural check — reject obviously malformed inputs before hitting DB
    if (email.length === 0 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "A valid email address is required." },
        { status: 400 }
      );
    }

    // ── DB query ──────────────────────────────────────────────
    // Select only the minimum fields needed: existence + credential count.
    // We do NOT select password_hash or any sensitive fields.
    const user = await prisma.user.findFirst({
      where: { email },
      select: {
        user_id: true,
        deactivated_flag: true,
        _count: {
          select: { webauthnCredentials: true },
        },
      },
    });

    // ── Deactivated account ───────────────────────────────────
    // Return false — deactivated users cannot use biometrics.
    // This mirrors the behaviour of the login and options endpoints.
    if (!user || user.deactivated_flag) {
      // No audit event — this is a read-only probe and logging every
      // unknown-email hit would produce high-volume noise.
      return NextResponse.json({ hasPasskey: false }, { status: 200 });
    }

    // ── Credential count check ────────────────────────────────
    const hasPasskey = user._count.webauthnCredentials > 0;

    if (hasPasskey) {
      await logAuditEvent(
        "WEBAUTHN_PASSKEY_EXISTS_CHECK",
        Number(user.user_id),
        ip,
        ua,
        { found: true }
      );
    }

    return NextResponse.json({ hasPasskey }, { status: 200 });
  } catch (error) {
    console.error("[webauthn/passkey-exists] error:", error);
    await logAuditEvent("WEBAUTHN_PASSKEY_EXISTS_ERROR", undefined, ip, ua, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    // Return false on error so the login page degrades gracefully
    // (no auto-prompt, manual button hidden) rather than crashing.
    return NextResponse.json({ hasPasskey: false }, { status: 200 });
  }
}
