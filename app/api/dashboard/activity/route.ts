// ──────────────────────────────────────────────────────────────
// GET /api/dashboard/activity — Portfolio Activity Feed
// ──────────────────────────────────────────────────────────────
// Returns a paginated list of the authenticated user's recent portfolio
// activity events (views, connections, inquiries, contact saves, card scans).
//
// Authentication: Required (session_token cookie).
//
// Query params:
//   ?page=1      — 1-based page number (default: 1)
//   ?limit=20    — items per page (1–50, default: 20)
//   ?type=       — filter by activity_type (optional)
//
// Response shape:
// {
//   items: [
//     {
//       id:           string   — ActivityLog.id (BigInt serialized)
//       activityType: string   — PROFILE_VIEW | NEW_CONNECTION | ...
//       referenceId:  string | null
//       meta:         object | null
//       createdAt:    string   — ISO timestamp
//     }
//   ],
//   pagination: {
//     page:       number
//     limit:      number
//     totalItems: number
//     totalPages: number
//   }
// }
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { parseActivityMeta } from "@/server/lib/activity";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

// Feed page size bounds
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

// Allowed activity_type filter values
const ALLOWED_TYPES = new Set([
  "PROFILE_VIEW",
  "NEW_CONNECTION",
  "NEW_SCAN",
  "NEW_INQUIRY",
  "CONTACT_SAVED",
  "PROFILE_EDIT",
  "VIEWED_PORTFOLIO",
  "CONNECTION_SENT",
  "CONNECTION_ACCEPTED",
  "INQUIRY_SENT",
]);

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    // ── Rate Limiting ──────────────────────────────
    const rateCheck = checkRateLimit("dashboard", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    // ── Authentication ─────────────────────────────
    const rawToken = request.cookies.get("session_token")?.value;
    if (!rawToken) {
      return NextResponse.json(
        { error: "Authentication required.", requiresAuth: true },
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

    const userId = BigInt(session.userId);

    // ── Parse query params ─────────────────────────
    const { searchParams } = new URL(request.url);

    const rawPage  = parseInt(searchParams.get("page")  ?? "1",  10);
    const rawLimit = parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10);
    const rawType  = searchParams.get("type") ?? null;

    const page  = Number.isFinite(rawPage)  && rawPage  > 0 ? rawPage  : 1;
    const limit = Number.isFinite(rawLimit) && rawLimit >= MIN_LIMIT && rawLimit <= MAX_LIMIT
      ? rawLimit
      : DEFAULT_LIMIT;

    // Validate type filter against allow-list to prevent arbitrary DB queries
    const typeFilter = rawType && ALLOWED_TYPES.has(rawType.toUpperCase())
      ? rawType.toUpperCase()
      : null;

    const skip = (page - 1) * limit;

    // ── Fetch feed + total count in parallel ───────
    const where = {
      user_id:       userId,
      ...(typeFilter ? { activity_type: typeFilter } : {}),
    };

    const [items, totalItems] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
        select: {
          id:            true,
          activity_type: true,
          reference_id:  true,
          meta:          true,
          created_at:    true,
        },
      }),
      prisma.activityLog.count({ where }),
    ]);

    const totalPages = Math.ceil(totalItems / limit);

    return NextResponse.json(
      serialize({
        items: items.map((row) => ({
          id:           row.id,
          activityType: row.activity_type,
          referenceId:  row.reference_id,
          meta:         parseActivityMeta(row.meta),
          createdAt:    row.created_at,
        })),
        pagination: {
          page,
          limit,
          totalItems,
          totalPages,
        },
      }),
      { status: 200 }
    );
  } catch (err) {
    console.error("[dashboard/activity] Unhandled error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
