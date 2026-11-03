// ──────────────────────────────────────────────────────────────
// GET /api/portfolio/[uri]/connection-status
// ──────────────────────────────────────────────────────────────
// Public (auth optional) lookup of the relationship between the current
// viewer and the portfolio owner. Used by the portfolio UI to decide
// whether the Associate-request modal should appear.
//
// Response (200):
//   {
//     authenticated: boolean,
//     status: "self" | "pending" | "accepted" | "declined" | "blocked" | "none"
//   }
//
// Guests receive { authenticated: false, status: "none" }.
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { validateToken } from "@/server/lib/auth";
import { resolvePortfolioOwnerByPublicUri } from "@/server/lib/analytics";

const CUSTOM_URI_REGEX = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]{2,64}$/;

function none(authenticated: boolean) {
  return NextResponse.json({ authenticated, status: "none" }, { status: 200 });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uri: string }> },
) {
  try {
    const { uri } = await params;
    if (!uri || !CUSTOM_URI_REGEX.test(uri)) {
      return none(false);
    }

    const rawToken = request.cookies.get("session_token")?.value;
    if (!rawToken) {
      return none(false);
    }
    const session = await validateToken(rawToken);
    if (!session) {
      return none(false);
    }

    const owner = await resolvePortfolioOwnerByPublicUri(uri);
    if (!owner?.user_id) {
      return none(true);
    }

    const viewerId = BigInt(session.userId);
    if (viewerId === owner.user_id) {
      return NextResponse.json({ authenticated: true, status: "self" }, { status: 200 });
    }

    const existing = await prisma.connection.findFirst({
      where: {
        OR: [
          { requester_user_id: viewerId, recipient_user_id: owner.user_id },
          { requester_user_id: owner.user_id, recipient_user_id: viewerId },
        ],
      },
      select: { status: true },
    });

    return NextResponse.json(
      { authenticated: true, status: existing?.status ?? "none" },
      { status: 200 },
    );
  } catch (err) {
    console.error("[portfolio/connection-status] lookup failed:", err);
    return none(false);
  }
}
