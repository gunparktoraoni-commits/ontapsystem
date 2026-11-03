// ──────────────────────────────────────────────────────────────
// POST /api/monitoring/error-log — Client Error Logging
// ──────────────────────────────────────────────────────────────
// Receives runtime error reports from the frontend application.
// Designed to be called by the global error monitoring script
// injected into the frontend on page load.
//
// This endpoint is intentionally public (no auth required) so it
// can receive errors from unauthenticated users too. Abuse is
// prevented through:
//   1. IP rate limiting (30 per minute)
//   2. Request body size limit (32KB) enforced by Next.js config
//   3. Strict payload validation & sanitization
//   4. Log injection prevention (control characters stripped)
//   5. All string fields are length-capped before DB insert
//
// Optional: If a session_token cookie is present, the user's ID
// is read and attached to the error log for better traceability.
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { validateErrorLogInput } from "@/server/lib/validators";
import { logClientError } from "@/server/lib/error-logger";
import { checkRateLimit } from "@/server/lib/rate-limit";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    // ── Rate Limiting ──────────────────────────────
    // 30 requests per minute per IP — allows bursts from error storms
    // while blocking intentional flooding.
    const rateCheck = checkRateLimit("error-log", ip);
    if (!rateCheck.allowed) {
      // Return 204 (No Content) instead of 429 — the frontend monitoring
      // script doesn't need to handle this error. Silently drop excess logs.
      return new NextResponse(null, { status: 204 });
    }

    // ── Parse Body ─────────────────────────────────
    // We parse manually to enforce a maximum body size guard.
    // The actual byte-level limit is set in next.config.ts via bodyParser.
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      );
    }

    // ── Validate & Sanitize ────────────────────────
    const validation = validateErrorLogInput(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.errors.join(" ") },
        { status: 400 }
      );
    }

    // ── Optionally Identify Authenticated User ─────
    // If the request has a session cookie, attach the user ID to the log.
    // This makes error correlation much easier in production debugging.
    // We do NOT require auth — unauthenticated user errors are just as important.
    let userId: number | null = null;
    const sessionToken = request.cookies.get("session_token")?.value;
    if (sessionToken) {
      try {
        const session = await validateToken(sessionToken);
        if (session) userId = session.userId;
      } catch {
        // Session lookup failure is non-critical — proceed without userId
      }
    }

    // ── Persist Error Log ──────────────────────────
    // logClientError() handles final severity classification and DB write
    await logClientError(validation.data, userId);

    // ── Respond ────────────────────────────────────
    // 204 No Content — the frontend doesn't need a body, just confirmation
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Error log ingestion failed:", error);
    // Return 204 so the frontend monitoring script doesn't retry endlessly
    return new NextResponse(null, { status: 204 });
  }
}
