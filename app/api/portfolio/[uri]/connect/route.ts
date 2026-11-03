// ──────────────────────────────────────────────────────────────
// POST /api/portfolio/[uri]/connect — Send a Connection Request
// ──────────────────────────────────────────────────────────────
// Allows an authenticated user to send a Friend or Associate connection
// request to the owner of a public portfolio page.
//
// This action REQUIRES authentication — anonymous visitors are prompted
// to log in or create an account before they can connect.
//
// Business rules:
//   - A user cannot connect with themselves
//   - Only one active request is allowed per requester-recipient pair,
//     regardless of direction (blocks both A→B when B→A exists too)
//   - A "blocked" status prevents the blocked user from ever sending
//     a new request to that portfolio owner
//   - Declined requests can be re-requested (allows retry after some time)
//     — the old declined record is replaced with a new pending one
//   - Accepted connections cannot be re-requested (already connected)
//
// Body:
//   { relationshipType?: "friend" | "associate" }   (defaults to "friend")
//
// Response (201 Created):
//   { connectionId, status: "pending", message }
//
// Error responses:
//   401 — not authenticated
//   404 — portfolio owner not found or not published
//   409 — connection already exists (pending, accepted, or blocked)
//   422 — cannot connect with yourself
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { validateToken, getClientIp, logAuditEvent, getUserAgent } from "@/server/lib/auth";
import { validateConnectionRequestInput } from "@/server/lib/validators";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getUserDisplayName, logActivity } from "@/server/lib/activity";
import { clearConnectionCachePrefix } from "@/server/lib/connections";
import { createNotificationFromEvent } from "@/server/lib/notifications";

const CUSTOM_URI_REGEX = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]{2,64}$/;

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

function notifyConnectionRequest(
  requesterId: bigint,
  recipientId: bigint,
  connectionId: bigint,
  relationshipType: string,
): void {
  clearConnectionCachePrefix(`summary:${requesterId.toString()}:`);
  clearConnectionCachePrefix(`summary:${recipientId.toString()}:`);
  clearConnectionCachePrefix(`list:${requesterId.toString()}:`);
  clearConnectionCachePrefix(`list:${recipientId.toString()}:`);

  void createNotificationFromEvent({
    targetUserId: recipientId,
    triggerUserId: requesterId,
    eventType: "friend_request_sent",
    priority: "critical",
    metadata: {
      relationship_type: relationshipType,
      request_id: connectionId.toString(),
    },
    needsEmail: true,
    emailPriority: "immediate",
  }).catch((error) => {
    console.error("[portfolio/connect] notification dispatch failed:", error);
  });
}

/**
 * Handle CORS preflight requests
 * Browser sends OPTIONS before POST for cross-origin requests
 */
export async function OPTIONS(
  request: NextRequest,
  { params }: { params: Promise<{ uri: string }> }
) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}

// ──────────────────────────────────────────────────────────────
// GET /api/portfolio/[uri]/connect — Relationship status
// ──────────────────────────────────────────────────────────────
// Returns the current connection relationship between the viewer and
// the portfolio owner so the client can decide whether to surface the
// "Associate request" modal.
//
// Response (200):
//   {
//     authenticated: boolean,
//     status: "self" | "pending" | "accepted" | "declined" | "blocked" | "none"
//   }
//
// Notes:
//   - Never requires auth. Guests receive { authenticated: false, status: "none" }
//     so the sign-in prompt can still be shown.
//   - "self" is returned when the viewer owns the portfolio (server-authoritative,
//     avoids relying on a possibly-stale client customUri comparison).
//   - "pending" / "accepted" / "blocked" mean an active request already exists and
//     the modal should stay suppressed.
// ──────────────────────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uri: string }> }
) {
  try {
    const { uri } = await params;
    if (!uri || !CUSTOM_URI_REGEX.test(uri)) {
      return NextResponse.json({ authenticated: false, status: "none" }, { status: 200 });
    }

    const rawToken = request.cookies.get("session_token")?.value;
    if (!rawToken) {
      return NextResponse.json({ authenticated: false, status: "none" }, { status: 200 });
    }
    const session = await validateToken(rawToken);
    if (!session) {
      return NextResponse.json({ authenticated: false, status: "none" }, { status: 200 });
    }

    const owner = await prisma.bizcard.findFirst({
      where: {
        url_alias: uri,
        deactivated_flag: false,
        user: { is: { is_active: true } },
      },
      select: { user_id: true },
    });

    if (!owner?.user_id) {
      return NextResponse.json({ authenticated: true, status: "none" }, { status: 200 });
    }

    const viewerId = BigInt(session.userId);
    const recipientId = owner.user_id;

    if (viewerId === recipientId) {
      return NextResponse.json({ authenticated: true, status: "self" }, { status: 200 });
    }

    const existing = await prisma.connection.findFirst({
      where: {
        OR: [
          { requester_user_id: viewerId, recipient_user_id: recipientId },
          { requester_user_id: recipientId, recipient_user_id: viewerId },
        ],
      },
      select: { status: true },
    });

    return NextResponse.json(
      { authenticated: true, status: existing?.status ?? "none" },
      { status: 200 }
    );
  } catch (err) {
    console.error("[portfolio/connect] status lookup failed:", err);
    return NextResponse.json({ authenticated: false, status: "none" }, { status: 200 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ uri: string }> }
) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  try {
    // ── Rate Limiting ──────────────────────────────
    const rateCheck = checkRateLimit("connection-request", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many connection requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    // ── Auth: session required ─────────────────────
    const rawToken = request.cookies.get("session_token")?.value;
    if (!rawToken) {
      return NextResponse.json(
        { error: "You must be logged in to connect with someone.", requiresAuth: true },
        { status: 401 }
      );
    }
    const session = await validateToken(rawToken);
    if (!session) {
      return NextResponse.json(
        { error: "Session expired. Please log in again.", requiresAuth: true },
        { status: 401 }
      );
    }

    // ── Validate URI param ─────────────────────────
    const { uri } = await params;
    if (!uri || !CUSTOM_URI_REGEX.test(uri)) {
      return NextResponse.json({ error: "Portfolio not found." }, { status: 404 });
    }

    // ── Parse body ─────────────────────────────────
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      // Use defaults
    }
    const { data: connData } = validateConnectionRequestInput(body);

    // ── Resolve portfolio owner ────────────────────
    const owner = await prisma.bizcard.findFirst({
      where: {
        url_alias: uri,
        deactivated_flag: false,
        user: {
          is: {
            is_active: true,
          },
        },
      },
      select: { user_id: true, bizcard_id: true },
    });

    if (!owner?.user_id) {
      return NextResponse.json({ error: "Portfolio not found." }, { status: 404 });
    }

    const requesterId = BigInt(session.userId);
    const recipientId = owner.user_id;

    // ── Self-connection guard ──────────────────────
    if (requesterId === recipientId) {
      return NextResponse.json(
        { error: "You cannot send a connection request to yourself." },
        { status: 422 }
      );
    }

    // ── Existing connection check (bidirectional) ──
    // Check both A→B and B→A to prevent duplicate/reverse requests.
    const existing = await prisma.connection.findFirst({
      where: {
        OR: [
          { requester_user_id: requesterId, recipient_user_id: recipientId },
          { requester_user_id: recipientId, recipient_user_id: requesterId },
        ],
      },
      select: { connect_id: true, status: true },
    });

    if (existing) {
      if (existing.status === "blocked") {
        // Do not reveal who blocked whom — just say "cannot connect"
        return NextResponse.json(
          { error: "Connection request could not be sent." },
          { status: 409 }
        );
      }
      if (existing.status === "pending") {
        return NextResponse.json(
          { error: "A connection request is already pending between you and this user." },
          { status: 409 }
        );
      }
      if (existing.status === "accepted") {
        return NextResponse.json(
          { error: "You are already connected with this user." },
          { status: 409 }
        );
      }
      // Status is "declined" — allow re-request by updating the existing record
      // rather than creating a duplicate (preserves the @@unique constraint).
      const updated = await prisma.connection.update({
        where: { connect_id: existing.connect_id },
        data: {
          // If the original requester is retrying, keep direction; otherwise swap
          requester_user_id: requesterId,
          recipient_user_id: recipientId,
          bizcard_id: owner.bizcard_id,
          relationship_type: connData.relationshipType,
          status: "pending",
          updated_at: new Date(),
        },
      });

      await logAuditEvent(
        "CONNECTION_REQUESTED",
        session.userId,
        ip,
        ua,
        {
          recipientId: recipientId.toString(),
          connectionId: updated.connect_id.toString(),
          relationshipType: connData.relationshipType,
          rerequest: true,
        }
      );

      // Fire-and-forget: notify the recipient's dashboard feed.
      void getUserDisplayName(requesterId).then((requesterName) => {
        void logActivity(
          Number(recipientId),
          "NEW_CONNECTION",
          updated.connect_id,
          { relationshipType: connData.relationshipType, fromName: requesterName }
        );
      });
      void getUserDisplayName(recipientId).then((recipientName) => {
        void logActivity(
          Number(requesterId),
          "CONNECTION_SENT",
          updated.connect_id,
          { relationshipType: connData.relationshipType, targetName: recipientName }
        );
      });

      notifyConnectionRequest(
        requesterId,
        recipientId,
        updated.connect_id,
        connData.relationshipType,
      );

      return NextResponse.json(
        serialize({
          connectionId: updated.connect_id,
          status: "pending",
          message: "Connection request re-sent.",
        }),
        { status: 201 }
      );
    }

    // ── Create new connection request ──────────────
    const connection = await prisma.connection.create({
      data: {
        requester_user_id: requesterId,
        recipient_user_id: recipientId,
        bizcard_id: owner.bizcard_id,
        relationship_type: connData.relationshipType,
        status: "pending",
      },
    });

    await logAuditEvent(
      "CONNECTION_REQUESTED",
      session.userId,
      ip,
      ua,
      {
        recipientId: recipientId.toString(),
        connectionId: connection.connect_id.toString(),
        relationshipType: connData.relationshipType,
      }
    );

    void getUserDisplayName(requesterId).then((requesterName) => {
      void logActivity(
        Number(recipientId),
        "NEW_CONNECTION",
        connection.connect_id,
        { relationshipType: connData.relationshipType, fromName: requesterName }
      );
    });
    void getUserDisplayName(recipientId).then((recipientName) => {
      void logActivity(
        Number(requesterId),
        "CONNECTION_SENT",
        connection.connect_id,
        { relationshipType: connData.relationshipType, targetName: recipientName }
      );
    });

    notifyConnectionRequest(
      requesterId,
      recipientId,
      connection.connect_id,
      connData.relationshipType,
    );

    return NextResponse.json(
      serialize({
        connectionId: connection.connect_id,
        status: "pending",
        message: "Connection request sent.",
      }),
      { status: 201 }
    );
  } catch (err) {
    console.error("[portfolio/connect] Unhandled error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
