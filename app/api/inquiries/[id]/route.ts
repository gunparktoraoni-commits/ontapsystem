// ──────────────────────────────────────────────────────────────
// GET /api/inquiries/[id]    — Inquiry detail
// PATCH /api/inquiries/[id]  — Update inquiry status
// DELETE /api/inquiries/[id] — Soft delete inquiry
// ──────────────────────────────────────────────────────────────
// Owner-only endpoint. Every operation is scoped to the authenticated
// portfolio owner (`user_id = session.userId`) to prevent IDOR.
//
// PATCH body:
//   { status: "new" | "unread" | "read" | "replied" }
//
// DELETE behavior:
//   1) Reads inquiry row
//   2) Stores full snapshot to DeletedRecord
//   3) Deletes inquiry row
// All 3 steps run in one transaction.
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  buildInquirySenderProfile,
  loadInquirySenderProfiles,
} from "@/server/lib/inquiry-sender";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

const ALLOWED_UPDATE_STATUSES = ["new", "unread", "read", "replied"] as const;

function parseInquiryId(raw: string): bigint | null {
  if (!/^\d{1,20}$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

async function validateOwnerSession(request: NextRequest) {
  const rawToken = request.cookies.get("session_token")?.value;
  if (!rawToken) {
    return { ok: false as const, response: NextResponse.json({ error: "Authentication required.", requiresAuth: true }, { status: 401 }) };
  }

  const session = await validateToken(rawToken);
  if (!session) {
    return { ok: false as const, response: NextResponse.json({ error: "Session expired. Please log in again.", requiresAuth: true }, { status: 401 }) };
  }

  return { ok: true as const, userId: BigInt(session.userId) };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);

  try {
    const rateCheck = checkRateLimit("inquiries-detail", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      );
    }

    const auth = await validateOwnerSession(request);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const inquiryId = parseInquiryId(id);
    if (inquiryId === null) {
      return NextResponse.json({ error: "Invalid inquiry ID." }, { status: 400 });
    }

    const inquiry = await prisma.inquiry.findFirst({
      where: {
        inquiry_id: inquiryId,
        user_id: auth.userId,
      },
      select: {
        inquiry_id: true,
        user_id: true,
        sender_user_id: true,
        visitor_name: true,
        visitor_email: true,
        visitor_phone: true,
        subject: true,
        message: true,
        status: true,
        read_flag: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!inquiry) {
      return NextResponse.json({ error: "Inquiry not found." }, { status: 404 });
    }

    const senderProfiles = await loadInquirySenderProfiles([inquiry]);
    const sender = buildInquirySenderProfile(inquiry, senderProfiles);

    return NextResponse.json(serialize({ inquiry: { ...inquiry, sender } }), { status: 200 });
  } catch (err) {
    console.error("[inquiries/GET detail] Unhandled error:", err);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);

  try {
    // ── Rate Limiting ──────────────────────────────
    const rateCheck = checkRateLimit("inquiries-update", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      );
    }

    const auth = await validateOwnerSession(request);
    if (!auth.ok) return auth.response;

    // ── Validate ID param ──────────────────────────
    const { id } = await params;
    const inquiryId = parseInquiryId(id);
    if (inquiryId === null) {
      return NextResponse.json({ error: "Invalid inquiry ID." }, { status: 400 });
    }

    // ── Parse body ─────────────────────────────────
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body is required." }, { status: 400 });
    }

    const rawStatus = body.status;
    if (
      typeof rawStatus !== "string" ||
      !(ALLOWED_UPDATE_STATUSES as readonly string[]).includes(rawStatus)
    ) {
      return NextResponse.json(
        { error: `status must be one of: ${ALLOWED_UPDATE_STATUSES.join(", ")}.` },
        { status: 400 }
      );
    }
    const newStatus = rawStatus as "new" | "unread" | "read" | "replied";

    // Use updateMany with owner scope to avoid IDOR leakage.
    const result = await prisma.inquiry.updateMany({
      where: {
        inquiry_id: inquiryId,
        user_id: auth.userId,
      },
      data: {
        status: newStatus,
        // Keep read_flag in sync for any legacy consumers
        read_flag: newStatus === "read" || newStatus === "replied",
        updated_at: new Date(),
      },
    });

    if (result.count === 0) {
      // Either doesn't exist or doesn't belong to this user — return same 404
      return NextResponse.json({ error: "Inquiry not found." }, { status: 404 });
    }

    return NextResponse.json(
      serialize({ inquiryId, status: newStatus })
    );
  } catch (err) {
    console.error("[inquiries/PATCH] Unhandled error:", err);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);

  try {
    const rateCheck = checkRateLimit("inquiries-delete", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      );
    }

    const auth = await validateOwnerSession(request);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const inquiryId = parseInquiryId(id);
    if (inquiryId === null) {
      return NextResponse.json({ error: "Invalid inquiry ID." }, { status: 400 });
    }

    const deleted = await prisma.$transaction(async (tx) => {
      const inquiry = await tx.inquiry.findFirst({
        where: {
          inquiry_id: inquiryId,
          user_id: auth.userId,
        },
      });

      if (!inquiry) {
        return null;
      }

      // Soft-delete ledger: keep a full snapshot before physical delete.
      await tx.deletedRecord.create({
        data: {
          table_name: "Inquiry",
          record_id: inquiry.inquiry_id.toString(),
          deleted_by: auth.userId,
          original_data: JSON.parse(JSON.stringify(inquiry, (_, v) => (typeof v === "bigint" ? v.toString() : v))),
          reason: "owner_soft_delete",
        },
      });

      await tx.inquiry.delete({ where: { inquiry_id: inquiry.inquiry_id } });

      return inquiry.inquiry_id;
    }, { timeout: 15000 });

    if (!deleted) {
      return NextResponse.json({ error: "Inquiry not found." }, { status: 404 });
    }

    return NextResponse.json(serialize({ deleted: true, inquiryId: deleted }), { status: 200 });
  } catch (err) {
    console.error("[inquiries/DELETE] Unhandled error:", err);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
