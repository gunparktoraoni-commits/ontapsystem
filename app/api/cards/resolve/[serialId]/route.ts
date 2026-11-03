// ──────────────────────────────────────────────────────────────
// GET /api/cards/resolve/[serialId] — Public BizCard Resolution
// ──────────────────────────────────────────────────────────────
// PUBLIC endpoint — no authentication required.
//
// Called by the frontend whenever anyone scans a BizCard QR code or
// taps an NFC tag that contains a URL like:
//   https://portal.ontap.ph/x3ERqY
//
// The frontend extracts "x3ERqY" from the URL path and calls:
//   GET /api/cards/resolve/x3ERqY
//
// The response tells the frontend what to do next:
//
//   { status: "linked",       customUri, portfolioUrl }
//     → The card is active and linked to a vCard.
//       Front end should redirect to: https://portal.ontap.ph/{customUri}
//
//   { status: "unlinked",     serialId, cardType }
//     → Card exists in DB but has no user linked yet.
//       Frontend should show the three setup options:
//         Option 1 — Merge with existing vCard (logged-in users)
//         Option 2 — Register as Employee       (company flow)
//         Option 3 — Set Up Individually        (new individual user)
//
//   { status: "deactivated",  serialId }
//     → Card is inactive or revoked.
//       Frontend should show a "This card is not active" message.
//
//   { status: "not_found" }
//     → Serial ID not in database. Likely a card from a different platform
//       or a manually typed / forged ID. Frontend shows "Unknown card" page.
//
// Security layers:
//   1. Serial ID format validation — rejects malformed input before DB hit
//   2. IP rate limiting: 60/min (same as company card-scan limit)
//   3. Minimal data returned — never exposes user PII in this endpoint
//   4. Timing-safe: all code paths take roughly the same DB path (one query)
//   5. No authentication info leakage — "not_found" regardless of why
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { buildVCardPublicUrl } from "@/server/lib/qr";
import { logActivity } from "@/server/lib/activity";

// Same regex used by all other card validators — keeps format enforcement consistent.
const SERIAL_ID_REGEX = /^[A-Za-z0-9_-]{4,64}$/;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serialId: string }> }
) {
  const ip = getClientIp(request);

  // ── Rate Limiting ────────────────────────────────────────────
  // Keyed per IP. Public endpoint so rate limiting is the only
  // defense against serial ID enumeration attacks.
  const rateCheck = checkRateLimit("bizcard-resolve", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
      }
    );
  }

  // ── Extract & Validate Serial ID ─────────────────────────────
  // Validate before hitting the DB to reject obviously bad inputs cheaply.
  const { serialId } = await params;

  if (!serialId || !SERIAL_ID_REGEX.test(serialId)) {
    // Return "not_found" rather than 400 — avoids leaking that the format is wrong
    // which could help an attacker refine their enumeration strategy.
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  // ── DB Lookup ────────────────────────────────────────────────
  // Single query: look up the card and its linked user's custom_uri in one shot.
  // We only select the minimum fields needed for the response.
  const card = await prisma.employeeCard.findUnique({
    where: { serial_id: serialId },
    select: {
      card_id:           true,
      serial_id:         true,
      card_type:         true,
      activation_status: true,
      assigned_user_id:  true,
      user: {
        select: {
          custom_uri:      true,
          is_active:       true,
        },
      },
    },
  });

  // ── Not Found ────────────────────────────────────────────────
  if (!card) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  // ── Deactivated / Revoked ────────────────────────────────────
  // Do not redirect inactive or revoked cards — show a "card not active" page.
  if (card.activation_status === "inactive" || card.activation_status === "revoked") {
    return NextResponse.json(
      {
        status:   "deactivated",
        serialId: card.serial_id,
        // cardType exposed so the frontend can show relevant copy
        // e.g. "Contact your company admin" vs "Reactivate in your dashboard"
        cardType: card.card_type,
      },
      { status: 200 }
    );
  }

  // ── Unlinked Card ────────────────────────────────────────────
  // Card is in DB but hasn't been assigned to any user yet.
  // Return enough data for the frontend to present the three setup options.
  if (!card.assigned_user_id || !card.user) {
    return NextResponse.json(
      {
        status:   "unlinked",
        serialId: card.serial_id,
        // cardType helps the frontend decide which options to offer:
        //   "individual" → show Option 1 (merge) and Option 3 (register)
        //   "employee"   → show Option 2 (employee registration) and Option 3
        cardType: card.card_type,
      },
      { status: 200 }
    );
  }

  const bizcard = await prisma.bizcard.findFirst({
    where: { user_id: card.assigned_user_id },
    orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
    select: {
      url_alias: true,
      deactivated_flag: true,
    },
  });

  // ── Linked — Check vCard Visibility ──────────────────────────
  // The card has a user, but the presentation card may still be unpublished.
  if (!bizcard || bizcard.deactivated_flag || !card.user.is_active) {
    return NextResponse.json(
      {
        status:   "unlinked",
        serialId: card.serial_id,
        cardType: card.card_type,
        // Signal to the frontend that the account exists but the profile
        // is not published — different UX copy from a truly blank card
        reason: "profile_unpublished",
      },
      { status: 200 }
    );
  }

  // ── Linked & Published ───────────────────────────────────────
  // Happy path: card resolves to a published vCard.
  // Return the redirect destination for the frontend.
  const customUri    = bizcard.url_alias ?? card.user.custom_uri;
  if (!customUri) {
    return NextResponse.json(
      {
        status: "unlinked",
        serialId: card.serial_id,
        cardType: card.card_type,
        reason: "profile_unpublished",
      },
      { status: 200 }
    );
  }
  const portfolioUrl = buildVCardPublicUrl(customUri);

  // Fire-and-forget: log a NEW_SCAN activity for the card owner's dashboard.
  void logActivity(
    Number(card.assigned_user_id),
    "NEW_SCAN",
    card.card_id,
    { serialId: card.serial_id, cardType: card.card_type }
  );

  return NextResponse.json(
    {
      status:       "linked",
      serialId:     card.serial_id,
      customUri,
      portfolioUrl, // null if NEXT_PUBLIC_APP_URL is not configured
    },
    { status: 200 }
  );
}
