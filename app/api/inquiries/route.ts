// ──────────────────────────────────────────────────────────────
// GET /api/inquiries — Owner Inquiry Inbox
// ──────────────────────────────────────────────────────────────
// Returns inquiry rows for the authenticated portfolio owner with:
//   • status filter (new|unread|read|replied)
//   • keyword search (subject, sender name, sender email)
//   • date range filtering (date_from/date_to)
//   • pagination (page/limit)
//
// Sorting rule required by product:
//   1) Most recent date first
//   2) Within a date: unread/new first, then read, then replied
//
// Security:
//   • Full session validation
//   • Owner scoping (user_id = session.userId)
//   • Input validation and bounded pagination
//   • Per-IP rate limiting
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  enrichInquiriesWithSender,
  loadInquirySenderProfiles,
} from "@/server/lib/inquiry-sender";
import { buildBizcardInquiryWhere, isSoleActiveBizcardForOwner } from "@/server/lib/analytics";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

const ALLOWED_STATUSES = new Set(["new", "unread", "read", "replied"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toPositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseDateBoundary(raw: string | null, endOfDay: boolean): Date | null {
  if (!raw || !DATE_RE.test(raw)) return null;
  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
  const date = new Date(`${raw}${suffix}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * GET /api/inquiries — Fetch the authenticated user's inquiry inbox.
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    // ── Rate Limiting ──────────────────────────────
    const rateCheck = checkRateLimit("inquiries-list", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      );
    }

    // ── Auth ───────────────────────────────────────
    const rawToken = request.cookies.get("session_token")?.value;
    if (!rawToken) {
      return NextResponse.json({ error: "Authentication required.", requiresAuth: true }, { status: 401 });
    }
    const session = await validateToken(rawToken);
    if (!session) {
      return NextResponse.json({ error: "Session expired. Please log in again.", requiresAuth: true }, { status: 401 });
    }

    // ── Parse query params ─────────────────────────
    const { searchParams } = request.nextUrl;

    const statusFilter = (searchParams.get("status") ?? "").trim().toLowerCase();
    const search = (searchParams.get("search") ?? "").trim().slice(0, 100);
    const page = toPositiveInt(searchParams.get("page"), 1);
    const limit = Math.min(toPositiveInt(searchParams.get("limit"), 10), 100);
    const skip = (page - 1) * limit;
    const dateFrom = parseDateBoundary(searchParams.get("date_from"), false);
    const dateTo = parseDateBoundary(searchParams.get("date_to"), true);
    const bizcardIdRaw = (searchParams.get("bizcard_id") ?? "").trim();

    let bizcardScope: { user_id: bigint; bizcard_id?: bigint } | null = null;
    if (bizcardIdRaw) {
      let parsedBizcardId: bigint;
      try {
        parsedBizcardId = BigInt(bizcardIdRaw);
      } catch {
        return NextResponse.json({ error: "Invalid bizcard_id." }, { status: 422 });
      }
      const owned = await prisma.bizcard.findFirst({
        where: {
          bizcard_id: parsedBizcardId,
          user_id: BigInt(session.userId),
          deactivated_flag: false,
        },
        select: { bizcard_id: true, user_id: true },
      });
      if (!owned?.user_id) {
        return NextResponse.json({ error: "Bizcard not found." }, { status: 404 });
      }
      const sole = await isSoleActiveBizcardForOwner(owned.user_id, owned.bizcard_id);
      bizcardScope = buildBizcardInquiryWhere(owned.user_id, owned.bizcard_id, sole);
    }

    if (statusFilter && !ALLOWED_STATUSES.has(statusFilter)) {
      return NextResponse.json(
        { error: "Invalid status. Allowed: new, unread, read, replied." },
        { status: 422 }
      );
    }

    if (dateFrom && dateTo && dateFrom > dateTo) {
      return NextResponse.json(
        { error: "date_from must be before or equal to date_to." },
        { status: 422 }
      );
    }

    // Build Prisma where for total-count and unread counter queries.
    const whereBase: Prisma.InquiryWhereInput = bizcardScope
      ? { ...bizcardScope }
      : { user_id: BigInt(session.userId) };

    if (statusFilter) {
      whereBase.status = statusFilter === "unread" ? { in: ["new", "unread"] } : statusFilter;
    }

    if (search) {
      whereBase.OR = [
        { subject: { contains: search } },
        { visitor_name: { contains: search } },
        { visitor_email: { contains: search } },
      ];
    }

    if (dateFrom || dateTo) {
      whereBase.created_at = {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {}),
      };
    }

    const ownerId = BigInt(session.userId);
    const unreadWhere: Prisma.InquiryWhereInput = bizcardScope
      ? { ...bizcardScope, status: { in: ["new", "unread"] } }
      : { user_id: ownerId, status: { in: ["new", "unread"] } };
    const statusGroupWhere: Prisma.InquiryWhereInput = bizcardScope
      ? { ...bizcardScope }
      : { user_id: ownerId };

    // ── Parallel queries: total + unread count + status totals + row page ──
    const [total, unreadCount, statusGroups, inquiries] = await Promise.all([
      prisma.inquiry.count({ where: whereBase }),
      prisma.inquiry.count({ where: unreadWhere }),
      prisma.inquiry.groupBy({
        by: ["status"],
        where: statusGroupWhere,
        _count: { _all: true },
      }),
      // Use raw SQL for product-required ordering by date bucket + status priority.
      prisma.$queryRaw<Array<{
        inquiry_id: bigint;
        sender_user_id: bigint | null;
        visitor_name: string | null;
        visitor_email: string | null;
        visitor_phone: string | null;
        subject: string | null;
        message: string;
        status: string;
        read_flag: boolean;
        created_at: Date;
        updated_at: Date | null;
      }>>(Prisma.sql`
        SELECT
          inquiry_id,
          sender_user_id,
          visitor_name,
          visitor_email,
          visitor_phone,
          subject,
          message,
          status,
          read_flag,
          created_at,
          updated_at
        FROM Inquiry
        WHERE user_id = ${BigInt(session.userId)}
          ${bizcardScope?.bizcard_id
            ? Prisma.sql`AND bizcard_id = ${bizcardScope.bizcard_id}`
            : Prisma.empty}
          ${statusFilter
            ? statusFilter === "unread"
              ? Prisma.sql`AND status IN ("new", "unread")`
              : Prisma.sql`AND status = ${statusFilter}`
            : Prisma.empty}
          ${search
            ? Prisma.sql`AND (
                subject LIKE ${`%${search}%`} OR
                visitor_name LIKE ${`%${search}%`} OR
                visitor_email LIKE ${`%${search}%`}
              )`
            : Prisma.empty}
          ${dateFrom ? Prisma.sql`AND created_at >= ${dateFrom}` : Prisma.empty}
          ${dateTo ? Prisma.sql`AND created_at <= ${dateTo}` : Prisma.empty}
        ORDER BY
          DATE(created_at) DESC,
          CASE
            WHEN status = "new" THEN 0
            WHEN status = "unread" THEN 0
            WHEN status = "read" THEN 1
            WHEN status = "replied" THEN 2
            ELSE 3
          END ASC,
          created_at DESC
        LIMIT ${limit} OFFSET ${skip}
      `),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    const countByStatus = Object.fromEntries(
      statusGroups.map((row) => [row.status, row._count._all]),
    ) as Record<string, number>;
    const counts = {
      all:
        (countByStatus.new ?? 0) +
        (countByStatus.unread ?? 0) +
        (countByStatus.read ?? 0) +
        (countByStatus.replied ?? 0),
      unread: (countByStatus.new ?? 0) + (countByStatus.unread ?? 0),
      read: countByStatus.read ?? 0,
      replied: countByStatus.replied ?? 0,
      new: countByStatus.new ?? 0,
    };

    const senderProfiles = await loadInquirySenderProfiles(inquiries);
    const enrichedInquiries = enrichInquiriesWithSender(inquiries, senderProfiles);

    return NextResponse.json(
      serialize({
        inquiries: enrichedInquiries,
        total,
        page,
        limit,
        totalPages,
        unreadCount,
        counts,
        filters: {
          status: statusFilter || null,
          search: search || null,
          date_from: searchParams.get("date_from") || null,
          date_to: searchParams.get("date_to") || null,
        },
      })
    );
  } catch (err) {
    console.error("[inquiries/GET] Unhandled error:", err);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
