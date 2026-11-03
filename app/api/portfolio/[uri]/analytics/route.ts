// ──────────────────────────────────────────────────────────────
// GET /api/portfolio/[uri]/analytics — Portfolio Analytics Dashboard
// ──────────────────────────────────────────────────────────────
// Returns aggregated engagement statistics for the portfolio owner's
// analytics dashboard. Only the portfolio owner may access this endpoint.
//
// Scope guard:
//   The authenticated session user's custom_uri must match the [uri] param.
//   This prevents one user from reading another user's analytics (IDOR).
//
// Response structure:
//   {
//     overview: {
//       totalViews           — all-time raw view count
//       uniqueVisitors       — distinct logged-in users + anonymous sessions
//       contactsSaved        — total contact save events
//       connectionRequests   — total requests received by this portfolio
//       acceptedConnections  — connections in "accepted" state
//       pendingConnections   — connections in "pending" state
//       totalInquiries       — all inquiries received
//       unreadInquiries      — inquiries with status = "unread"
//     },
//     viewsByDay: [{ date: "YYYY-MM-DD", count: number }]  — last 30 days
//     deviceBreakdown: [{ device: string, count: number }]
//     browserBreakdown: [{ browser: string, count: number }]
//     recentVisitors: [{ userId, firstName, lastName, profileUrl, customUri, viewedAt }]
//       — last 20 distinct logged-in visitors (anonymous visitors excluded for privacy)
//     contactSavesByType: [{ saveType: string, count: number }]
//   }
//
// All queries are scoped to the authenticated user's portfolio_owner_id
// to provide full data isolation between portfolio owners.
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { prismaAnalytics } from "@/server/lib/prisma-analytics";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

const CUSTOM_URI_REGEX = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]{2,64}$/;

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

const getGroupedCount = (countValue: unknown, key: string): number => {
  if (!countValue || typeof countValue !== "object") return 0;
  const countRecord = countValue as Record<string, number | undefined>;
  return countRecord[key] ?? 0;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uri: string }> }
) {
  const ip = getClientIp(request);

  try {
    // ── Rate Limiting ──────────────────────────────
    const rateCheck = checkRateLimit("portfolio-analytics", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    // ── Auth: session required ─────────────────────
    const rawToken = request.cookies.get("session_token")?.value;
    if (!rawToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const session = await validateToken(rawToken);
    if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    // ── Validate URI param ─────────────────────────
    const { uri } = await params;
    if (!uri || !CUSTOM_URI_REGEX.test(uri)) {
      return NextResponse.json({ error: "Portfolio not found." }, { status: 404 });
    }

    // ── Ownership check (IDOR prevention) ─────────
    // Resolve the owner by URI and verify it belongs to the session user.
    // This prevents authenticated users from querying other portfolios' analytics.
    const owner = await prisma.bizcard.findFirst({
      where: {
        url_alias: uri,
        user_id: BigInt(session.userId), // Must match authenticated user
        deactivated_flag: false,
        user: {
          is: {
            is_active: true,
          },
        },
      },
      select: { user_id: true, bizcard_id: true },
    });

    if (!owner) {
      // URI exists but belongs to someone else, or doesn't exist — same 403
      return NextResponse.json(
        { error: "You are not authorized to view this portfolio's analytics." },
        { status: 403 }
      );
    }

    if (owner.user_id == null) {
      return NextResponse.json(
        { error: "You are not authorized to view this portfolio's analytics." },
        { status: 403 }
      );
    }

    const ownerId = owner.user_id;
    const bizcardId = owner.bizcard_id;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const analyticsWhere = bizcardId ? { bizcard_id: bizcardId } : { portfolio_owner_id: ownerId };

    // ── Run all aggregation queries in parallel ────
    // Each query is independently scoped by portfolio_owner_id / user_id
    // so they can safely run concurrently.
    const [
      totalViews,
      distinctLoggedInVisitors,
      distinctAnonSessions,
      contactsSaved,
      connectionRequests,
      acceptedConnections,
      pendingConnections,
      totalInquiries,
      unreadInquiries,
      viewsLast30Days,
      deviceCounts,
      browserCounts,
      recentVisitorRows,
      contactSavesByType,
    ] = await Promise.all([
      // ① Total all-time view count
      prismaAnalytics.portfolioView.count({
        where: analyticsWhere,
      }),

      // ② Distinct logged-in visitors (unique user_id)
      prismaAnalytics.portfolioView.groupBy({
        by: ["visitor_user_id"],
        where: {
          ...analyticsWhere,
          visitor_user_id: { not: null },
        },
        _count: { visitor_user_id: true },
      }),

      // ③ Distinct anonymous sessions
      prismaAnalytics.portfolioView.groupBy({
        by: ["anonymous_session_id"],
        where: {
          ...analyticsWhere,
          visitor_user_id: null,
          anonymous_session_id: { not: null },
        },
        _count: { anonymous_session_id: true },
      }),

      // ④ Total contacts saved
      prismaAnalytics.contactSave.count({
        where: analyticsWhere,
      }),

      // ⑤ Total connection requests received
      prisma.connection.count({
        where: bizcardId ? { bizcard_id: bizcardId } : { recipient_user_id: ownerId },
      }),

      // ⑥ Accepted connections
      prisma.connection.count({
        where: bizcardId ? { bizcard_id: bizcardId, status: "accepted" } : { recipient_user_id: ownerId, status: "accepted" },
      }),

      // ⑦ Pending connections
      prisma.connection.count({
        where: bizcardId ? { bizcard_id: bizcardId, status: "pending" } : { recipient_user_id: ownerId, status: "pending" },
      }),

      // ⑧ Total inquiries
      prisma.inquiry.count({
        where: bizcardId ? { bizcard_id: bizcardId } : { user_id: ownerId },
      }),

      // ⑨ Unread inquiries
      prisma.inquiry.count({
        where: bizcardId ? { bizcard_id: bizcardId, status: "unread" } : { user_id: ownerId, status: "unread" },
      }),

      // ⑩ Daily view counts for the last 30 days
      // Prisma doesn't support DATE() directly — fetch raw rows and group in JS
      prismaAnalytics.portfolioView.findMany({
        where: {
          ...analyticsWhere,
          created_at: { gte: thirtyDaysAgo },
        },
        select: { created_at: true },
        orderBy: { created_at: "asc" },
      }),

      // ⑪ Device type breakdown
      prismaAnalytics.portfolioView.groupBy({
        by: ["device_type"],
        where: analyticsWhere,
        _count: { device_type: true },
      }),

      // ⑫ Browser breakdown
      prismaAnalytics.portfolioView.groupBy({
        by: ["browser"],
        where: { ...analyticsWhere, browser: { not: null } },
        _count: { browser: true },
      }),

      // ⑬ Recent logged-in visitor user IDs (visitor details fetched from main DB below)
      prismaAnalytics.portfolioView.findMany({
        where: {
          ...analyticsWhere,
          visitor_user_id: { not: null },
        },
        orderBy: { created_at: "desc" },
        take: 100,
        select: {
          visitor_user_id: true,
          created_at: true,
        },
      }),

      // ⑭ Contact save type breakdown
      prismaAnalytics.contactSave.groupBy({
        by: ["save_type"],
        where: analyticsWhere,
        _count: { save_type: true },
      }),
    ]);

    // ── Post-process: unique visitors count ────────
    // Unique visitors = distinct logged-in user IDs + distinct anonymous session IDs
    const uniqueVisitors = distinctLoggedInVisitors.length + distinctAnonSessions.length;

    // ── Post-process: views by day ─────────────────
    // Group raw timestamp rows into a "YYYY-MM-DD" → count map
    const viewsByDayMap = new Map<string, number>();
    for (const row of viewsLast30Days) {
      // Format as YYYY-MM-DD in UTC to keep consistent across server timezones
      const day = row.created_at.toISOString().slice(0, 10);
      viewsByDayMap.set(day, (viewsByDayMap.get(day) ?? 0) + 1);
    }
    // Convert to sorted array; fill gaps with 0 for a complete 30-day series
    const viewsByDay: { date: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      viewsByDay.push({ date, count: viewsByDayMap.get(date) ?? 0 });
    }

    // ── Post-process: device breakdown ────────────
    const deviceBreakdown = deviceCounts.map((row: { device_type: string | null; _count: { device_type: number } }) => ({
      device: row.device_type ?? "unknown",
      count: getGroupedCount(row._count, "device_type"),
    }));

    // ── Post-process: browser breakdown ───────────
    const browserBreakdown = browserCounts
      .map((row: { browser: string | null; _count: { browser: number } }) => ({
        browser: row.browser ?? "unknown",
        count: getGroupedCount(row._count, "browser"),
      }))
      .sort((a: { browser: string; count: number }, b: { browser: string; count: number }) => b.count - a.count)
      .slice(0, 10);

    // ── Post-process: recent visitors dedup ───────
    // Fetch visitor user details from main DB (cross-DB join — analytics is separate)
    const uniqueVisitorIds = Array.from(
      new Set(
        recentVisitorRows
          .filter((r: { visitor_user_id: bigint | null; created_at: Date }) => r.visitor_user_id != null)
          .map((r: { visitor_user_id: bigint | null; created_at: Date }) => r.visitor_user_id!)
      )
    ) as bigint[];

    const visitorUsers =
      uniqueVisitorIds.length > 0
        ? await prisma.user.findMany({
            where: { user_id: { in: uniqueVisitorIds } },
            select: {
              user_id:     true,
              first_name:  true,
              last_name:   true,
              profile_url: true,
              custom_uri:  true,
            },
          })
        : [];

    const visitorMap = new Map(
      visitorUsers.map((v) => [v.user_id.toString(), v])
    );

    // Keep only the first (most recent) visit per user to get "distinct recent visitors"
    const seen = new Set<string>();
    const recentVisitors: {
      userId: string;
      firstName: string;
      lastName: string;
      profileUrl: string | null;
      customUri: string | null;
      viewedAt: string;
    }[] = [];

    for (const row of recentVisitorRows) {
      if (!row.visitor_user_id) continue;
      const key = row.visitor_user_id.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      const visitor = visitorMap.get(key);
      if (!visitor) continue;
      recentVisitors.push({
        userId:     visitor.user_id.toString(),
        firstName:  visitor.first_name,
        lastName:   visitor.last_name,
        profileUrl: visitor.profile_url,
        customUri:  visitor.custom_uri,
        viewedAt:   row.created_at.toISOString(),
      });
      if (recentVisitors.length === 20) break;
    }

    // ── Post-process: contact saves by type ───────
    const contactSavesBreakdown = contactSavesByType.map((row: { save_type: string; _count: { save_type: number } }) => ({
      saveType: row.save_type,
      count: getGroupedCount(row._count, "save_type"),
    }));

    return NextResponse.json(
      serialize({
        overview: {
          totalViews,
          uniqueVisitors,
          contactsSaved,
          connectionRequests,
          acceptedConnections,
          pendingConnections,
          totalInquiries,
          unreadInquiries,
        },
        viewsByDay,
        deviceBreakdown,
        browserBreakdown,
        recentVisitors,
        contactSavesByType: contactSavesBreakdown,
      })
    );
  } catch (err) {
    console.error("[portfolio/analytics] Unhandled error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
