// ──────────────────────────────────────────────────────────────
// PATCH /api/cards/[cardId] — Update BizCard Activation Status
// ──────────────────────────────────────────────────────────────
// Allows the card owner (individual) or the company admin (employee cards)
// to temporarily deactivate or reactivate their BizCard.
//
// When a card is "inactive":
//   - Scans resolve to { status: "deactivated" }
//   - The frontend shows a "this card is not active" message to scanners
//   - The card is NOT deleted; it can be reactivated at any time
//
// What CANNOT be changed via this endpoint:
//   - serial_id (permanently immutable)
//   - card_type (managed by the platform)
//   - company_id / assigned_user_id (requires unlink/re-link workflows)
//   - "revoked" status (platform/admin-only action; irreversible)
//
// Authorization rules:
//   Individual card (card_type = "individual"):
//     → Only the card owner (card.assigned_user_id == session.userId) may modify it
//
//   Employee card (card_type = "employee"):
//     → Only the company admin whose company owns the card may modify it
//       (card.company_id == admin's company_id)
//     → Regular employees cannot deactivate their own company card
//
// Security layers:
//   1. Middleware auth guard (session_token cookie required)
//   2. Full session DB validation (revocation, deactivation)
//   3. Ownership check as described above (IDOR prevention)
//   4. IP rate limiting: 20/hour — status changes are rare
//   5. Input validation — only "active" | "inactive" accepted
//   6. Revoked cards are permanently locked; cannot be changed via API
//   7. Audit logging
//
// Response (200 OK):
//   {
//     message:          string
//     cardId:           number
//     serialId:         string
//     activationStatus: "active" | "inactive"
//   }
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
import { validateCardStatusUpdateInput } from "@/server/lib/validators";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  ensureCompanyRole,
  resolveCompanyActorContext,
} from "@/server/lib/company";
import { AppError } from "@/lib/errors/types";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ cardId: string }> }
) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  try {
    // ── Rate Limiting ──────────────────────────────
    const rateCheck = checkRateLimit("card-status", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many status change requests. Please try again later." },
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

    // ── Validate cardId Path Parameter ────────────
    const { cardId: cardIdStr } = await params;
    const cardIdNum = parseInt(cardIdStr, 10);
    if (!Number.isFinite(cardIdNum) || cardIdNum <= 0) {
      return NextResponse.json({ error: "Invalid card ID." }, { status: 400 });
    }
    const cardId = BigInt(cardIdNum);

    // ── Parse & Validate Body ──────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const validation = validateCardStatusUpdateInput(body);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.errors[0] }, { status: 400 });
    }

    const { activationStatus } = validation.data;

    // ── Fetch Card ─────────────────────────────────
    const card = await prisma.employeeCard.findUnique({
      where:  { card_id: cardId },
      select: {
        card_id:           true,
        serial_id:         true,
        card_type:         true,
        company_id:        true,
        assigned_user_id:  true,
        activation_status: true,
      },
    });

    if (!card) {
      return NextResponse.json({ error: "Card not found." }, { status: 404 });
    }

    // ── Revoked Cards Are Locked ───────────────────
    // "revoked" is a terminal state — it cannot be changed via this API.
    // Only a platform super-admin operation could handle this.
    if (card.activation_status === "revoked") {
      return NextResponse.json(
        { error: "This card has been permanently revoked and cannot be modified." },
        { status: 409 }
      );
    }

    // ── Authorization ──────────────────────────────
    const sessionUserId = BigInt(auth.session.userId);
    let actorUserId = auth.session.userId;

    if (card.card_type === "individual") {
      // Individual card — only the owner may modify it
      if (card.assigned_user_id === null || card.assigned_user_id !== sessionUserId) {
        await logAuditEvent("CARD_STATUS_FORBIDDEN", actorUserId, ip, ua, {
          cardId: cardIdNum,
          reason: "not_owner",
        });
        return NextResponse.json(
          { error: "Forbidden. You can only modify your own card." },
          { status: 403 }
        );
      }
    } else {
      // Employee card — only the company admin who owns this card may modify it
      let adminCompanyId: bigint;

      try {
        const context = await resolveCompanyActorContext({
          userId: BigInt(resolveEffectiveUserId(auth)),
          requestId: "card-status",
        });
        ensureCompanyRole(context, ["admin"], "card-status");
        adminCompanyId = context.companyId;
        actorUserId = Number(context.userId);
      } catch (error) {
        if (error instanceof AppError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        return NextResponse.json(
          { error: "Forbidden. Only company admins can modify employee cards." },
          { status: 403 }
        );
      }

      if (!card.company_id || adminCompanyId !== card.company_id) {
        await logAuditEvent("CARD_STATUS_FORBIDDEN", actorUserId, ip, ua, {
          cardId: cardIdNum,
          reason: "wrong_company",
        });
        return NextResponse.json(
          { error: "Forbidden. This card does not belong to your company." },
          { status: 403 }
        );
      }
    }

    // ── Idempotent Check ───────────────────────────
    if (card.activation_status === activationStatus) {
      return NextResponse.json(
        {
          message:          `Card is already ${activationStatus}.`,
          cardId:           Number(card.card_id),
          serialId:         card.serial_id,
          activationStatus: card.activation_status,
        },
        { status: 200 }
      );
    }

    // ── Update Status ──────────────────────────────
    const updated = await prisma.employeeCard.update({
      where: { card_id: cardId },
      data: {
        activation_status: activationStatus,
        // Reset activated_at when going back to "active"
        ...(activationStatus === "active" && { activated_at: new Date() }),
        updated_at: new Date(),
      },
      select: {
        card_id:           true,
        serial_id:         true,
        activation_status: true,
      },
    });

    // ── Audit Log ──────────────────────────────────
    await logAuditEvent("CARD_STATUS_UPDATED", actorUserId, ip, ua, {
      cardId:    cardIdNum,
      serialId:  card.serial_id,
      from:      card.activation_status,
      to:        activationStatus,
      cardType:  card.card_type,
    });

    return NextResponse.json(
      {
        message:          `Card ${activationStatus === "active" ? "reactivated" : "deactivated"} successfully.`,
        cardId:           Number(updated.card_id),
        serialId:         updated.serial_id,
        activationStatus: updated.activation_status,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[cards/[cardId]] Error:", error);
    await logAuditEvent("CARD_STATUS_ERROR", undefined, ip, ua, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
