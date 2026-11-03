// ──────────────────────────────────────────────────────────────
// POST /api/portfolio/[uri]/view — Record a Portfolio Page Visit
// ──────────────────────────────────────────────────────────────
// Called by the frontend immediately after rendering a public portfolio page.
//
// Public endpoint — no authentication required.
// Optional authentication — if a valid session cookie is present, the
// visitor's user_id is extracted and stored for richer analytics.
//
// Deduplication strategy (applied in order):
//   1. IP rate limiting: 30 requests/min protects against scripted flooding
//   2. Owner self-views are never recorded
//   3. Skip if same visitor (user_id, sessionId, or IP hash) viewed this portfolio
//      within the last 30 minutes
//
// IP Privacy:
//   The raw client IP is never stored. We store an HMAC-SHA256 hash
//   keyed with IP_HASH_SECRET so the hashes are useless without the key.
//
// Frontend contract:
//   - sessionId: a UUID v4 generated once and persisted in localStorage
//   - deviceType, browser, os: parsed from navigator.userAgent on the client
//   - referrer: window.document.referrer (trimmed to 512 chars)
//
// Body (all optional):
//   { sessionId?, deviceType?, browser?, os?, referrer? }
//
// Response (200 OK):
//   { tracked: true }  — new view recorded
//   { tracked: false, reason: "duplicate" }  — suppressed by dedup logic
//   { tracked: false, reason: "not_found" }  — URI not found / not published
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prismaAnalytics } from "@/server/lib/prisma-analytics";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { validatePortfolioViewInput } from "@/server/lib/validators";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getUserDisplayName, logActivity } from "@/server/lib/activity";
import {
  buildAnonymizedIpPrefix,
  extractGeoMetadata,
  hashVisitorIp,
  isDuplicatePortfolioView,
  isPortfolioOwnerSelfVisit,
  isTrackablePublicPortfolioUri,
  resolvePortfolioOwnerByPublicUri,
} from "@/server/lib/analytics";
import { createNotificationFromEvent } from "@/server/lib/notifications";

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ uri: string }> }
) {
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent")?.slice(0, 512) ?? null;
  const geo = extractGeoMetadata(request);

  try {
    // ── Rate Limiting ──────────────────────────────
    const rateCheck = checkRateLimit("portfolio-view", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    // ── Validate URI param ─────────────────────────
    const { uri: rawUri } = await params;
    if (!rawUri || !isTrackablePublicPortfolioUri(rawUri)) {
      return NextResponse.json({ tracked: false, reason: "not_found" }, { status: 404 });
    }

    // ── Parse & validate body ──────────────────────
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      // Body is entirely optional — proceed with empty object
    }
    const { data: viewData } = validatePortfolioViewInput(body);

    // ── Optional session extraction ────────────────
    // Read session cookie if present; never error on missing/invalid cookie
    let visitorUserId: number | null = null;
    try {
      const rawToken = request.cookies.get("session_token")?.value;
      if (rawToken) {
        const session = await validateToken(rawToken);
        if (session) visitorUserId = session.userId;
      }
    } catch {
      // Non-fatal — treat as anonymous visit
    }

    // ── Resolve portfolio owner ────────────────────
    // Only record views for published portfolios to prevent feeding analytics
    // for draft profiles that aren't intentionally public.
    const owner = await resolvePortfolioOwnerByPublicUri(rawUri);

    if (!owner?.user_id) {
      // Return success-like response to avoid leaking whether the URI exists
      return NextResponse.json({ tracked: false, reason: "not_found" }, { status: 404 });
    }

    if (isPortfolioOwnerSelfVisit(owner.user_id, visitorUserId)) {
      return NextResponse.json({ tracked: false, reason: "duplicate" });
    }

    const ipHash = hashVisitorIp(ip);
    const ipPrefix = buildAnonymizedIpPrefix(ip);

    const isDuplicate = await isDuplicatePortfolioView(owner.user_id, {
      userId: visitorUserId,
      sessionId: viewData.sessionId,
      ipHash,
      ipPrefix,
    });
    if (isDuplicate) {
      return NextResponse.json({ tracked: false, reason: "duplicate" });
    }

    // ── Record the view ────────────────────────────
    try {
      await prismaAnalytics.$executeRaw`
        INSERT INTO PortfolioView (
          portfolio_owner_id,
          bizcard_id,
          visitor_user_id,
          anonymous_session_id,
          visitor_ip_hash,
          visitor_ip_prefix,
          visitor_user_agent,
          device_type,
          browser,
          os,
          referrer,
          country_code,
          country,
          city,
          latitude,
          longitude,
          created_at
        ) VALUES (
          ${owner.user_id},
          ${owner.bizcard_id},
          ${visitorUserId ? BigInt(visitorUserId) : null},
          ${viewData.sessionId},
          ${ipHash},
          ${ipPrefix},
          ${userAgent},
          ${viewData.deviceType},
          ${viewData.browser},
          ${viewData.os},
          ${viewData.referrer},
          ${geo.countryCode},
          ${geo.country},
          ${geo.city},
          ${geo.latitude},
          ${geo.longitude},
          ${new Date()}
        )
      `;
    } catch {
      // Legacy analytics DB without bizcard_id column.
      await prismaAnalytics.$executeRaw`
        INSERT INTO PortfolioView (
          portfolio_owner_id,
          visitor_user_id,
          anonymous_session_id,
          visitor_ip_hash,
          visitor_ip_prefix,
          visitor_user_agent,
          device_type,
          browser,
          os,
          referrer,
          country_code,
          country,
          city,
          latitude,
          longitude,
          created_at
        ) VALUES (
          ${owner.user_id},
          ${visitorUserId ? BigInt(visitorUserId) : null},
          ${viewData.sessionId},
          ${ipHash},
          ${ipPrefix},
          ${userAgent},
          ${viewData.deviceType},
          ${viewData.browser},
          ${viewData.os},
          ${viewData.referrer},
          ${geo.countryCode},
          ${geo.country},
          ${geo.city},
          ${geo.latitude},
          ${geo.longitude},
          ${new Date()}
        )
      `;
    }

    // Fire-and-forget: record activity for the dashboard feed.
    // Pass device + browser as meta so the feed can show "Viewed on mobile".
    const locationLabel = [geo.city, geo.country].filter(Boolean).join(", ") || null;
    void logActivity(
      Number(owner.user_id),
      "PROFILE_VIEW",
      null,
      {
        ...(viewData.deviceType ? { device: viewData.deviceType } : {}),
        ...(viewData.browser    ? { browser: viewData.browser }   : {}),
        ...(locationLabel ? { location: locationLabel } : {}),
        anonymous: !visitorUserId,
      }
    );

    if (visitorUserId) {
      void getUserDisplayName(owner.user_id).then((ownerName) => {
        void logActivity(
          visitorUserId,
          "VIEWED_PORTFOLIO",
          owner.user_id,
          {
            targetName: ownerName,
            alias: rawUri,
          },
        );
      });
    }

    // Fire a profile_view / QR-scan notification for the portfolio owner.
    // We fire for both authenticated visitors (triggerUserId set) and anonymous
    // visitors (triggerUserId null) so the owner is notified of every unique
    // view — matching the "QR Scan Alerts" preference in Settings.
    //
    // createNotificationFromEvent respects the owner's preferences:
    //   - if `profile_view.in_app` is false → no in-app notification created
    //   - if email master switch (unsubscribed_at) or `profile_view.email` is
    //     false → no email queued
    // Self-view guard is already enforced above (isPortfolioOwnerSelfVisit).
    const notificationTriggerUserId =
      visitorUserId && BigInt(visitorUserId) !== owner.user_id
        ? BigInt(visitorUserId)
        : null;

    void createNotificationFromEvent({
      targetUserId: owner.user_id,
      triggerUserId: notificationTriggerUserId,
      eventType: "profile_view",
      metadata: {
        viewer_name: notificationTriggerUserId ? "A registered visitor" : "An anonymous visitor",
        viewer_business: null,
        bizcard_id: owner.bizcard_id.toString(),
        source: viewData.referrer ?? "direct_link",
        device: viewData.deviceType ?? null,
        location: geo.city && geo.country ? `${geo.city}, ${geo.country}` : geo.country ?? null,
      },
      needsEmail: false,
    }).catch((error) => {
      console.error("[portfolio/view] notification dispatch failed:", error);
    });

    return NextResponse.json({ tracked: true });
  } catch (err) {
    console.error("[portfolio/view] Unhandled error:", err);
    // Return a non-committing response so the frontend page load isn't blocked
    return NextResponse.json({ tracked: false }, { status: 500 });
  }
}
