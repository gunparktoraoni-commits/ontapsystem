// ──────────────────────────────────────────────────────────────
// PATCH /api/connections/[id] — Respond to a Connection Request
// ──────────────────────────────────────────────────────────────
// The recipient of a pending connection request accepts, declines, or blocks
// the requester. This is the inbox-management endpoint for portfolio owners.
//
// Authentication: required — only the recipient may respond.
//
// Business rules:
//   - Only the connection recipient may call this endpoint.
//     Requesters cannot modify a request they already sent.
//   - Only "pending" connections can be responded to.
//     Already-accepted or declined connections return 409.
//   - "blocked" is a terminal state: it prevents the requester from ever
//     sending a new request to this portfolio owner.
//   - "declined" re-opens: the requester may send again (see connect route).
//
// Body:
//   { action: "accept" | "decline" | "block" }
//
// action → new status mapping:
//   "accept"  → "accepted"
//   "decline" → "declined"
//   "block"   → "blocked"
//
// Response (200 OK):
//   { connectionId, status, message }
//
// Error responses:
//   400 — invalid action
//   401 — not authenticated
//   403 — authenticated user is not the recipient
//   404 — connection not found
//   409 — connection is not in pending state
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { validateToken, getClientIp, logAuditEvent, getUserAgent } from "@/server/lib/auth";
import { validateConnectionRespondInput } from "@/server/lib/validators";
import { checkRateLimit } from "@/server/lib/rate-limit";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

// Maps the frontend-friendly action name to the DB status value
const ACTION_TO_STATUS: Record<string, string> = {
  accept: "accepted",
  decline: "declined",
  block: "blocked",
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  try {
    // ── Rate Limiting ──────────────────────────────
    const rateCheck = checkRateLimit("connection-respond", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    // ── Auth: session required ─────────────────────
    const rawToken = request.cookies.get("session_token")?.value;
    if (!rawToken) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const session = await validateToken(rawToken);
    if (!session) {
      return NextResponse.json({ error: "Session expired. Please log in again." }, { status: 401 });
    }

    // ── Validate connection ID param ───────────────
    const { id } = await params;
    const connectionId = parseInt(id, 10);
    if (!Number.isFinite(connectionId) || connectionId <= 0) {
      return NextResponse.json({ error: "Invalid connection ID." }, { status: 400 });
    }

    // ── Parse & validate body ──────────────────────
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body is required." }, { status: 400 });
    }

    const validation = validateConnectionRespondInput(body);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.errors[0] }, { status: 400 });
    }
    const { action } = validation.data;

    // ── Load connection ────────────────────────────
    const connection = await prisma.connection.findUnique({
      where: { connect_id: BigInt(connectionId) },
      select: {
        connect_id: true,
        requester_user_id: true,
        recipient_user_id: true,
        status: true,
        relationship_type: true,
      },
    });

    if (!connection) {
      return NextResponse.json({ error: "Connection request not found." }, { status: 404 });
    }

    // ── Authorization: only recipient may respond ──
    // Comparing BigInt with Number requires explicit conversion.
    if (Number(connection.recipient_user_id) !== session.userId) {
      return NextResponse.json(
        { error: "You are not authorized to respond to this connection request." },
        { status: 403 }
      );
    }

    // ── State guard ────────────────────────────────
    if (connection.status !== "pending") {
      return NextResponse.json(
        {
          error: `This connection request has already been ${connection.status}. Only pending requests can be responded to.`,
          currentStatus: connection.status,
        },
        { status: 409 }
      );
    }

    // ── Update status ──────────────────────────────
    const newStatus = ACTION_TO_STATUS[action];

    const updated = await prisma.connection.update({
      where: { connect_id: connection.connect_id },
      data: {
        status: newStatus,
        updated_at: new Date(),
      },
    });

    await logAuditEvent(
      `CONNECTION_${action.toUpperCase()}ED`,
      session.userId,
      ip,
      ua,
      {
        connectionId: connection.connect_id.toString(),
        requesterId: connection.requester_user_id.toString(),
        relationshipType: connection.relationship_type,
        newStatus,
      }
    );

    const messages: Record<string, string> = {
      accepted: "Connection accepted.",
      declined: "Connection request declined.",
      blocked: "User has been blocked.",
    };

    return NextResponse.json(
      serialize({
        connectionId: updated.connect_id,
        status: newStatus,
        message: messages[newStatus],
      })
    );
  } catch (err) {
    console.error("[connections/respond] Unhandled error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
