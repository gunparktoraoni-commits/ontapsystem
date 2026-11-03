// ──────────────────────────────────────────────────────────────
// GET /api/dashboard/vcard-completion — vCard Completion Checker
// ──────────────────────────────────────────────────────────────
// Returns the authenticated user's vCard profile completeness as a
// percentage, broken down by field group so the frontend can show
// a progress bar and actionable "complete your profile" prompts.
//
// Authentication: Required (session_token cookie).
//
// The 13 scored fields are:
//   Basic (5):      profile_url, cover_url, prof_title, about, job_position
//   Contact (3):    email (always present), contact (phone), address (≥1 row)
//   Identity (2):   first_name (always present), last_name (always present)
//   Social (1):     socials (≥1 visible row)
//   Services (1):   services (≥1 row)
//   Products (1):   products (≥1 row)
//
// Response shape:
// {
//   percentage:  number    — 0–100, rounded to nearest integer
//   completed:   number    — count of filled fields
//   total:       number    — total scored fields
//   fields: {
//     profilePhoto:  boolean
//     coverPhoto:    boolean
//     profTitle:     boolean
//     about:         boolean
//     jobPosition:   boolean
//     email:         boolean
//     phone:         boolean
//     address:       boolean
//     firstName:     boolean
//     lastName:      boolean
//     socials:       boolean
//     services:      boolean
//     products:      boolean
//   }
// }
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

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

    // ── Fetch profile data ─────────────────────────
    // One main query + three count checks in parallel to keep latency low.
    const [user, addressCount, socialCount, serviceCount, productCount] =
      await Promise.all([
        prisma.user.findUnique({
          where: { user_id: userId },
          select: {
            first_name:  true,
            last_name:   true,
            profile_url: true,
            cover_url:   true,
            prof_title:  true,
            about:       true,
            job_position: true,
            email:       true,
            contact:     true,
          },
        }),

        prisma.address.count({ where: { user_id: userId } }),

        prisma.social.count({
          where: { user_id: userId, is_visible: true, deleted_at: null },
        }),

        prisma.service.count({ where: { user_id: userId } }),

        prisma.product.count({ where: { user_id: userId } }),
      ]);

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    // ── Score each field ───────────────────────────
    const fields = {
      profilePhoto: Boolean(user.profile_url),
      coverPhoto:   Boolean(user.cover_url),
      profTitle:    Boolean(user.prof_title),
      about:        Boolean(user.about),
      jobPosition:  Boolean(user.job_position),
      email:        Boolean(user.email),
      phone:        Boolean(user.contact),
      address:      addressCount > 0,
      firstName:    Boolean(user.first_name),
      lastName:     Boolean(user.last_name),
      socials:      socialCount  > 0,
      services:     serviceCount > 0,
      products:     productCount > 0,
    };

    const total     = Object.keys(fields).length;
    const completed = Object.values(fields).filter(Boolean).length;
    const percentage = Math.round((completed / total) * 100);

    return NextResponse.json(
      { percentage, completed, total, fields },
      { status: 200 }
    );
  } catch (err) {
    console.error("[dashboard/vcard-completion] Unhandled error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
