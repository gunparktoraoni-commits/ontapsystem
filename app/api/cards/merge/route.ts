// ──────────────────────────────────────────────────────────────
// POST /api/cards/merge — Link a BizCard to the Authenticated User's vCard
// ──────────────────────────────────────────────────────────────
// Called when an authenticated user who already has a vCard scans a
// blank BizCard and chooses "Merge with my existing vCard" (Option 1).
//
// What this endpoint does:
//   1. Validates the request and verifies the session
//   2. Ensures the user doesn't already have a BizCard linked
//   3. Looks up the scanned card; auto-creates it if it doesn't exist yet
//   4. Verifies the card is not already claimed by someone else
//   5. Atomically links the card → user and updates Bizcard.serial_id
//   6. Generates a fresh QR code pointing to the user's portfolio URL
//   7. Returns the card info + QR code to the frontend
//
// Pre-conditions that must be true before calling this endpoint:
//   • The user must be authenticated (session_token cookie)
//   • The user should ideally have a custom_uri set (for QR to be useful)
//     — if not, the QR won't be generated but the card IS still linked
//
// Security layers:
//   1. Middleware auth guard (session_token cookie required)
//   2. Full session DB validation (revocation, deactivation)
//   3. IP rate limiting: 5/hour — merging is a rare deliberate action;
//      a tight limit prevents scripted bulk-claiming of serial IDs
//   4. Input validation + sanitization
//   5. Ownership check: a card owned by a company cannot be merged
//      (only the company admin can assign company cards to employees)
//   6. Duplicate check: user cannot link more than one card
//   7. All DB mutations inside an atomic transaction
//   8. Audit logging for every outcome
//
// Response (200 OK):
//   {
//     message:      string
//     cardId:       number
//     serialId:     string
//     cardType:     "individual"
//     portfolioUrl: string | null   (null if custom_uri not set)
//     qrCode:       string | null   (base64 SVG data URL; use as <img src>)
//   }
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import {
  validateToken,
  logAuditEvent,
  getClientIp,
  getUserAgent,
} from "@/server/lib/auth";
import { validateCardMergeInput } from "@/server/lib/validators";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { generateQRCodeDataUrl, buildVCardPublicUrl } from "@/server/lib/qr";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  try {
    // ── Rate Limiting ──────────────────────────────
    const rateCheck = checkRateLimit("card-merge", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many merge requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    // ── Session Validation ─────────────────────────
    const rawToken = request.cookies.get("session_token")?.value;
    if (!rawToken) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const session = await validateToken(rawToken);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const userId = BigInt(session.userId);

    // ── Parse & Validate Input ─────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const validation = validateCardMergeInput(body);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.errors[0] }, { status: 400 });
    }

    const { serialId } = validation.data;

    // ── Check: User Doesn't Already Have a Card ────
    // Each user can only be linked to one BizCard. This check prevents
    // accidental duplicate linking and enforces the one-card-per-user rule.
    const userWithCard = await prisma.user.findUnique({
      where: { user_id: userId },
      select: {
        custom_uri:  true,
        employeeCard: {
          select: {
            card_id:           true,
            serial_id:         true,
            activation_status: true,
          },
        },
      },
    });

    if (!userWithCard) {
      return NextResponse.json({ error: "User account not found." }, { status: 404 });
    }

    if (userWithCard.employeeCard) {
      // Already has a card — idempotent if same serial_id, otherwise reject
      if (userWithCard.employeeCard.serial_id === serialId) {
        // Same card, nothing to do — return success (idempotent)
        const portfolioUrl = userWithCard.custom_uri
          ? buildVCardPublicUrl(userWithCard.custom_uri)
          : null;
        return NextResponse.json(
          {
            message:      "This card is already linked to your profile.",
            cardId:       Number(userWithCard.employeeCard.card_id),
            serialId,
            cardType:     "individual",
            portfolioUrl,
            qrCode:       null,
          },
          { status: 200 }
        );
      }

      // Different card — reject
      return NextResponse.json(
        { error: "Your account already has a BizCard linked. Please unlink it before linking a new one." },
        { status: 409 }
      );
    }

    // ── Look Up the Card ───────────────────────────
    const existingCard = await prisma.employeeCard.findUnique({
      where: { serial_id: serialId },
      select: {
        card_id:           true,
        card_type:         true,
        company_id:        true,
        assigned_user_id:  true,
        activation_status: true,
      },
    });

    // ── Company Card Guard ─────────────────────────
    // A card claimed by a company can only be assigned to employees by the
    // company admin (POST /api/cards/link-employee). Prevent individuals
    // from intercepting and self-claiming company cards.
    if (existingCard?.company_id != null) {
      await logAuditEvent("CARD_MERGE_COMPANY_CARD_REJECTED", session.userId, ip, ua, { serialId });
      return NextResponse.json(
        { error: "This card belongs to a company and cannot be linked to an individual account." },
        { status: 409 }
      );
    }

    // ── Already Assigned to Someone Else ──────────
    if (existingCard?.assigned_user_id != null) {
      if (existingCard.assigned_user_id === userId) {
        // Race condition: two concurrent merge requests — idempotent
        const portfolioUrl = userWithCard.custom_uri
          ? buildVCardPublicUrl(userWithCard.custom_uri)
          : null;
        return NextResponse.json(
          { message: "Card already linked to your profile.", cardId: Number(existingCard.card_id), serialId, cardType: "individual", portfolioUrl, qrCode: null },
          { status: 200 }
        );
      }
      await logAuditEvent("CARD_MERGE_ALREADY_TAKEN", session.userId, ip, ua, { serialId });
      return NextResponse.json(
        { error: "This card is already linked to another account." },
        { status: 409 }
      );
    }

    // ── Atomic Transaction ─────────────────────────
    // Create or update the card and link it to the user in a single
    // transaction so there is no window where the card appears unlinked.
    const now = new Date();

    const card = await prisma.$transaction(async (tx) => {
      // Upsert the card:
      //   - If it exists and is unclaimed → take ownership
      //   - If it doesn't exist → create it as an individual card
      const upserted = await tx.employeeCard.upsert({
        where: { serial_id: serialId },
        update: {
          card_type:         "individual",
          assigned_user_id:  userId,
          activation_status: "active",
          activated_at:      now,
          updated_at:        now,
        },
        create: {
          serial_id:         serialId,
          card_type:         "individual",
          company_id:        null,
          assigned_user_id:  userId,
          activation_status: "active",
          activated_at:      now,
        },
      });

      const targetBizcard = await tx.bizcard.findFirst({
        where: { user_id: userId, deactivated_flag: false },
        orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
        select: { bizcard_id: true },
      });

      if (targetBizcard) {
        await tx.bizcard.update({
          where: { bizcard_id: targetBizcard.bizcard_id },
          data: {
            serial_id: serialId,
            is_merged: true,
            bizcard_type: "physical",
            updated_at: now,
          },
        });
      }

      return upserted;
    }, { timeout: 15000 });

    // ── Generate QR Code ───────────────────────────
    // Done OUTSIDE the transaction — a QR failure must never roll back
    // the card link we just committed. Non-fatal: if QR fails the card
    // is still linked; the user can regenerate via /api/vcard/setup.
    let qrCode: string | null = null;
    let portfolioUrl: string | null = null;

    if (userWithCard.custom_uri) {
      portfolioUrl = buildVCardPublicUrl(userWithCard.custom_uri);
      if (portfolioUrl) {
        qrCode = generateQRCodeDataUrl(portfolioUrl);

        // Persist QR to VCardSetup for dashboard retrieval (best-effort)
        if (qrCode) {
          try {
            await prisma.vCardSetup.update({
              where: { user_id: userId },
              data:  { qr_code: qrCode, qr_generated_at: new Date() },
            });
          } catch {
            // Non-fatal — dashboard can regenerate later via /api/vcard/setup
          }
        }
      }
    }

    // ── Audit Log ──────────────────────────────────
    await logAuditEvent("CARD_MERGE_SUCCESS", session.userId, ip, ua, {
      serialId,
      cardId: Number(card.card_id),
      hadCustomUri: !!userWithCard.custom_uri,
    });

    return NextResponse.json(
      {
        message:      "BizCard successfully linked to your profile.",
        cardId:       Number(card.card_id),
        serialId:     card.serial_id,
        cardType:     "individual",
        portfolioUrl,
        qrCode,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[cards/merge] Error:", error);
    await logAuditEvent("CARD_MERGE_ERROR", undefined, ip, ua, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
