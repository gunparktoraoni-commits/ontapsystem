// ──────────────────────────────────────────────────────────────
// POST /api/portfolio/[uri]/save-contact — Record a Contact Save Event
// ──────────────────────────────────────────────────────────────
// Called by the frontend when a visitor clicks "Save Contact" or downloads
// the portfolio owner's vCard (.vcf file) or uses "Add to Contacts".
//
// Public endpoint — no authentication required.
// Optional authentication — if a session cookie is present, the visitor's
// user_id is stored for owner analytics ("who saved my contact?").
//
// Deduplication:
//   Owner self-saves are never recorded. Same visitor (user_id, sessionId, or IP
//   prefix) saving the same portfolio within 24 hours is recorded only once.
//
// Body:
//   { sessionId?, saveType?: "vcf" | "phone" }
//   saveType defaults to "vcf" if omitted.
//
// Response (200 OK):
//   { recorded: true }
//   { recorded: false, reason: "duplicate" | "not_found" }
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prismaAnalytics } from "@/server/lib/prisma-analytics";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { validateContactSaveInput } from "@/server/lib/validators";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { logActivity } from "@/server/lib/activity";
import {
  buildAnonymizedIpPrefix,
  extractGeoMetadata,
  isDuplicateContactSave,
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
    const rateCheck = checkRateLimit("contact-save", ip);
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
      return NextResponse.json({ recorded: false, reason: "not_found" }, { status: 404 });
    }

    // ── Parse body ─────────────────────────────────
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      // Optional body — proceed with defaults
    }
    const { data: saveData } = validateContactSaveInput(body);

    // ── Optional session extraction ────────────────
    let visitorUserId: number | null = null;
    try {
      const rawToken = request.cookies.get("session_token")?.value;
      if (rawToken) {
        const session = await validateToken(rawToken);
        if (session) visitorUserId = session.userId;
      }
    } catch {
      // Non-fatal — treat as anonymous
    }

    // ── Resolve portfolio owner ────────────────────
    const owner = await resolvePortfolioOwnerByPublicUri(rawUri);

    if (!owner?.user_id) {
      return NextResponse.json({ recorded: false, reason: "not_found" }, { status: 404 });
    }

    if (isPortfolioOwnerSelfVisit(owner.user_id, visitorUserId)) {
      return NextResponse.json({ recorded: false, reason: "duplicate" });
    }

    const ipPrefix = buildAnonymizedIpPrefix(ip);

    const isDuplicate = await isDuplicateContactSave(owner.user_id, {
      userId: visitorUserId,
      sessionId: saveData.sessionId,
      ipHash: null,
      ipPrefix,
    });
    if (isDuplicate) {
      return NextResponse.json({ recorded: false, reason: "duplicate" });
    }

    // ── Record the save ────────────────────────────
    try {
      await prismaAnalytics.$executeRaw`
        INSERT INTO ContactSave (
          portfolio_owner_id,
          bizcard_id,
          visitor_user_id,
          anonymous_session_id,
          save_type,
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
          ${saveData.sessionId},
          ${saveData.saveType},
          ${buildAnonymizedIpPrefix(ip)},
          ${userAgent},
          ${saveData.deviceType},
          ${saveData.browser},
          ${saveData.os},
          ${saveData.referrer},
          ${geo.countryCode},
          ${geo.country},
          ${geo.city},
          ${geo.latitude},
          ${geo.longitude},
          ${new Date()}
        )
      `;
    } catch {
      await prismaAnalytics.$executeRaw`
        INSERT INTO ContactSave (
          portfolio_owner_id,
          visitor_user_id,
          anonymous_session_id,
          save_type,
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
          ${saveData.sessionId},
          ${saveData.saveType},
          ${buildAnonymizedIpPrefix(ip)},
          ${userAgent},
          ${saveData.deviceType},
          ${saveData.browser},
          ${saveData.os},
          ${saveData.referrer},
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
    void logActivity(
      Number(owner.user_id),
      "CONTACT_SAVED",
      null,
      { saveType: saveData.saveType }
    );

    if (visitorUserId && BigInt(visitorUserId) !== owner.user_id) {
      void createNotificationFromEvent({
        targetUserId: owner.user_id,
        triggerUserId: BigInt(visitorUserId),
        eventType: "contact_download",
        priority: "high",
        metadata: {
          save_type: saveData.saveType,
          bizcard_id: owner.bizcard_id.toString(),
          device: saveData.deviceType ?? null,
          location: geo.city && geo.country ? `${geo.city}, ${geo.country}` : geo.country ?? null,
        },
        needsEmail: true,
        emailPriority: "batch",
      }).catch((error) => {
        console.error("[portfolio/save-contact] notification dispatch failed:", error);
      });
    }

    return NextResponse.json({ recorded: true });
  } catch (err) {
    console.error("[portfolio/save-contact] Unhandled error:", err);
    return NextResponse.json({ recorded: false }, { status: 500 });
  }
}
