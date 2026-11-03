// ──────────────────────────────────────────────────────────────
// GET /api/bizcards/user — List All BizCards for the Authenticated User
// ──────────────────────────────────────────────────────────────
// Returns every BizCard (EmployeeCard) connected to the authenticated
// user, regardless of how it was linked:
//
//   1. Personal card  — card.card_type = "individual", card.assigned_user_id = userId
//   2. Company card   — card.card_type = "employee",   card.company_id matches
//      the user's company AND card.assigned_user_id = userId
//   3. Any card row where assigned_user_id = userId (covers both types above)
//
// Since EmployeeCard has a @unique constraint on assigned_user_id,
// a regular user can have at most one card.  Company admins can also
// see all cards belonging to their company (owned but unassigned cards,
// other employees' cards).
//
// Response shape:
// {
//   cards: [
//     {
//       cardId:           string   — BigInt serialized
//       serialId:         string
//       cardType:         "individual" | "employee"
//       activationStatus: string
//       companyId:        string | null
//       companyName:      string | null
//       assignedUser: {
//         userId:     string
//         firstName:  string
//         lastName:   string
//         customUri:  string | null
//       } | null
//       qrCode:        string | null   — base64 SVG from VCardSetup
//       portfolioUrl:  string | null
//       connectedAt:   string          — ISO timestamp
//       scanCount:     number          — total scan events for this card
//     }
//   ],
//   pagination: { page, limit, totalItems, totalPages }
// }
//
// Authentication: Required (session_token cookie).
//
// Query params:
//   ?page=1       — 1-based page  (default 1)
//   ?limit=20     — items per page 1–50 (default 20)
//   ?sortBy=      — "created_at" | "serial_id" | "activation_status" (default "created_at")
//   ?sortDir=     — "asc" | "desc" (default "desc")
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { validateBizCardListParams } from "@/server/lib/validators";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { buildVCardPublicUrl } from "@/server/lib/qr";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    // ── Rate Limiting ──────────────────────────────
    const rateCheck = checkRateLimit("bizcards-list", ip);
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
    const { data: params } = validateBizCardListParams({
      page:    searchParams.get("page")    ?? 1,
      limit:   searchParams.get("limit")   ?? 20,
      sortBy:  searchParams.get("sortBy")  ?? "created_at",
      sortDir: searchParams.get("sortDir") ?? "desc",
    });

    // ── Build the WHERE clause ─────────────────────
    // A regular user sees only their own assigned card.
    // A company_admin sees ALL cards assigned to them + ALL cards in their
    // company (including unassigned cards and other employees' cards) so
    // they can manage the full inventory from the dashboard.
    const user = await prisma.user.findUnique({
      where:  { user_id: userId },
      select: { role: true, company_id: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    type WhereClause =
      | { assigned_user_id: bigint }
      | { OR: Array<{ assigned_user_id: bigint } | { company_id: bigint }> };

    const where: WhereClause =
      user.role === "company_admin" && user.company_id != null
        ? {
            OR: [
              { assigned_user_id: userId },
              { company_id: user.company_id },
            ],
          }
        : { assigned_user_id: userId };

    const skip = (params.page - 1) * params.limit;

    // ── Fetch cards + total in parallel ───────────
    const orderByField =
      params.sortBy === "serial_id"
        ? { serial_id: params.sortDir as "asc" | "desc" }
        : params.sortBy === "activation_status"
        ? { activation_status: params.sortDir as "asc" | "desc" }
        : { created_at: params.sortDir as "asc" | "desc" };

    const [cards, totalItems] = await Promise.all([
      prisma.employeeCard.findMany({
        where,
        orderBy: orderByField,
        skip,
        take: params.limit,
        select: {
          card_id:           true,
          serial_id:         true,
          card_type:         true,
          activation_status: true,
          company_id:        true,
          assigned_user_id:  true,
          activated_at:      true,
          created_at:        true,
          // Include company name
          company: {
            select: { company_id: true, name: true },
          },
          // Include basic user info
          user: {
            select: {
              user_id:    true,
              first_name: true,
              last_name:  true,
              custom_uri: true,
            },
          },
          // Count only — no need to return full scan rows to the list view
          _count: {
            select: { scans: true },
          },
        },
      }),

      prisma.employeeCard.count({ where }),
    ]);

    // Fetch Bizcard QR data for each user
    const userIds = [...new Set(cards.map((c) => c.assigned_user_id).filter(Boolean) as bigint[])];
    const bizcardQRMap = new Map<bigint, { qr_code_url: string | null; portfolio_url: string | null }>();

    if (userIds.length > 0) {
      const bizcords = await prisma.bizcard.findMany({
        where: {
          user_id: { in: userIds },
          deactivated_flag: false,
        },
        orderBy: { created_at: "desc" },
        select: {
          user_id: true,
          qr_code_url: true,
          portfolio_url: true,
        },
      });

      for (const bizcard of bizcords) {
        if (bizcard.user_id && !bizcardQRMap.has(bizcard.user_id)) {
          bizcardQRMap.set(bizcard.user_id, {
            qr_code_url: bizcard.qr_code_url,
            portfolio_url: bizcard.portfolio_url,
          });
        }
      }
    }

    const totalPages = Math.ceil(totalItems / params.limit);

    // ── Build response items ───────────────────────
    const items = cards.map((card) => {
      const assignedUserId = card.assigned_user_id;
      const customUri      = card.user?.custom_uri ?? null;

      // Get QR code and portfolio URL from Bizcard (preferred) or fall back to custom_uri
      const bizcardQR = assignedUserId ? bizcardQRMap.get(assignedUserId) : null;
      const qrCode = bizcardQR?.qr_code_url ?? null;
      const portfolioUrl = bizcardQR?.portfolio_url ?? (customUri ? buildVCardPublicUrl(customUri) : null);

      return {
        cardId:           card.card_id,
        serialId:         card.serial_id,
        cardType:         card.card_type,
        activationStatus: card.activation_status,
        companyId:        card.company_id,
        companyName:      card.company?.name ?? null,
        assignedUser:     card.user
          ? {
              userId:    card.user.user_id,
              firstName: card.user.first_name,
              lastName:  card.user.last_name,
              customUri,
            }
          : null,
        qrCode,
        portfolioUrl,
        // Use activated_at when available; fall back to card creation date
        connectedAt:  card.activated_at ?? card.created_at,
        scanCount:    card._count.scans,
      };
    });

    return NextResponse.json(
      serialize({
        cards: items,
        pagination: {
          page:       params.page,
          limit:      params.limit,
          totalItems,
          totalPages,
        },
      }),
      { status: 200 }
    );
  } catch (err) {
    console.error("[bizcards/user] Unhandled error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
