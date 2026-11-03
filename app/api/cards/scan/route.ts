// ──────────────────────────────────────────────────────────────
// POST /api/cards/scan — Employee Card Verification
// ──────────────────────────────────────────────────────────────
// Called by the frontend after extracting a serial ID from a
// QR code or NFC tap (e.g. URL: taptap.com/W3aFXi → "W3aFXi").
//
// Security layers:
// 1. Route is behind the middleware auth guard (session_token cookie required)
// 2. Full session validation happens here (DB lookup, revocation, deactivation)
// 3. Role enforcement — only "company_admin" may call this endpoint
// 4. IP rate limiting (60/min) — fast enough for scanning sessions,
//    tight enough to block serial ID enumeration attacks
// 5. Serial ID format validation — rejects malformed input before any DB query
// 6. No information leakage — "not found" and "invalid format" use distinct
//    codes so the UI can give actionable feedback, but never expose internals
//
// Response shapes:
//   { status: "not_found" }                  — serial ID not in DB
//   { status: "unassigned", serialId }        — card exists, no employee yet
//   { status: "assigned",   serialId, user }  — card linked to an employee
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import {
  resolveRequestSession,
  resolveEffectiveUserId,
  logAuditEvent,
  getClientIp,
  getUserAgent,
} from "@/server/lib/auth";
import { validateCardScanInput } from "@/server/lib/validators";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  ensureCompanyRole,
  resolveCompanyActorContext,
} from "@/server/lib/company";
import { AppError } from "@/lib/errors/types";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  try {
    // ── Rate Limiting ──────────────────────────────
    // Keyed per IP. 60 requests/min allows rapid scanning sessions
    // while blocking automated enumeration of serial IDs.
    const rateCheck = checkRateLimit("card-scan", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many scan requests. Please slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    // ── Session Validation ─────────────────────────
    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    let actorUserId: number;

    try {
      const context = await resolveCompanyActorContext({
        userId: BigInt(resolveEffectiveUserId(auth)),
        requestId: "cards-scan",
      });
      ensureCompanyRole(context, ["admin"], "cards-scan");
      actorUserId = Number(context.userId);
    } catch (error) {
      if (error instanceof AppError) {
        return NextResponse.json({ error: error.message }, { status: error.statusCode });
      }
      return NextResponse.json(
        { error: "Forbidden. Only company admins can scan cards." },
        { status: 403 }
      );
    }

    // ── Parse & Validate Input ─────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const validation = validateCardScanInput(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.errors[0] },
        { status: 400 }
      );
    }

    const { serialId } = validation.data;

    // ── Lookup Card ────────────────────────────────
    // Include the assigned user so we can return their profile in one query.
    const card = await prisma.employeeCard.findUnique({
      where: { serial_id: serialId },
      include: {
        user: {
          select: {
            user_id:      true,
            first_name:   true,
            last_name:    true,
            middle_name:  true,
            email:        true,
            contact:      true,
            job_position: true,
            profile_url:  true,
            role:         true,
            company_id:   true,
          },
        },
      },
    });

    // ── Not Found ──────────────────────────────────
    // The serial ID doesn't exist in the database at all.
    // This can happen if the card was never registered with the platform.
    if (!card) {
      await logAuditEvent("CARD_SCAN_NOT_FOUND", actorUserId, ip, ua, { serialId });
      return NextResponse.json({ status: "not_found" }, { status: 404 });
    }

    // ── Unassigned Card ────────────────────────────
    // Card exists but has not been linked to an employee yet.
    // Return the serial ID so the frontend can list it for assignment.
    if (!card.assigned_user_id || !card.user) {
      await logAuditEvent("CARD_SCAN_UNASSIGNED", actorUserId, ip, ua, {
        serialId,
        cardId:  Number(card.card_id),
        companyId: card.company_id ? Number(card.company_id) : null,
      });

      return NextResponse.json(
        {
          status:   "unassigned",
          serialId: card.serial_id,
          cardId:   Number(card.card_id),
          activationStatus: card.activation_status,
          // Include companyId so the frontend can check ownership
          companyId: card.company_id ? Number(card.company_id) : null,
        },
        { status: 200 }
      );
    }

    // ── Assigned Card ──────────────────────────────
    // Card is linked to an employee — return safe profile data.
    // We deliberately omit sensitive fields (password_hash, audit logs, etc.).
    await logAuditEvent("CARD_SCAN_ASSIGNED", actorUserId, ip, ua, {
      serialId,
      cardId:         Number(card.card_id),
      assignedUserId: Number(card.assigned_user_id),
    });

    return NextResponse.json(
      {
        status:   "assigned",
        serialId: card.serial_id,
        cardId:   Number(card.card_id),
        activationStatus: card.activation_status,
        user: {
          userId:      Number(card.user.user_id),
          firstName:   card.user.first_name,
          lastName:    card.user.last_name,
          middleName:  card.user.middle_name,
          email:       card.user.email,
          contact:     card.user.contact,
          jobPosition: card.user.job_position,
          profileUrl:  card.user.profile_url,
          role:        card.user.role,
          companyId:   card.user.company_id ? Number(card.user.company_id) : null,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Card scan error:", error);
    await logAuditEvent("CARD_SCAN_ERROR", undefined, ip, ua, {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
