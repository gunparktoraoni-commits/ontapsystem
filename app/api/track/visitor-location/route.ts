// ──────────────────────────────────────────────────────────────
// POST /api/track/visitor-location — Anonymous visitor geo ping
// ──────────────────────────────────────────────────────────────
// Public endpoint (no auth, CSRF-exempt via /api/track prefix).
// Called once per anonymous portfolio visit to enrich the latest
// PortfolioView row with city/country/coordinates.
//
// Body:
//   { visitorId?: string, alias?: string, pagePath?: string }
//
// Always returns 200 so analytics never blocks page load.
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prismaAnalytics } from "@/server/lib/prisma-analytics";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  extractGeoMetadata,
  hashVisitorIp,
  isTrackablePublicPortfolioUri,
  resolvePortfolioOwnerByPublicUri,
} from "@/server/lib/analytics";
import { getGeolocationFromIP, getLocationString } from "@/lib/services/geolocation.service";

const ok = (extra: Record<string, unknown> = {}) =>
  NextResponse.json({ tracked: true, ...extra }, { status: 200 });

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    const rateCheck = checkRateLimit("visitor-location", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { tracked: false, reason: "rate_limited" },
        {
          status: 200,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        },
      );
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      // empty body is fine
    }

    const visitorId =
      typeof body.visitorId === "string" ? body.visitorId.trim().slice(0, 128) : "";
    const aliasRaw =
      typeof body.alias === "string"
        ? body.alias
        : typeof body.pagePath === "string"
          ? String(body.pagePath).split("/").filter(Boolean)[0] ?? ""
          : "";
    const alias = String(aliasRaw).trim().replace(/^\/+/, "").toLowerCase();

    if (!alias || !isTrackablePublicPortfolioUri(alias)) {
      return ok({ reason: "invalid_alias" });
    }

    const owner = await resolvePortfolioOwnerByPublicUri(alias);
    if (!owner?.user_id) {
      return ok({ reason: "not_found" });
    }

    const headerGeo = extractGeoMetadata(request);
    let country = headerGeo.country;
    let countryCode = headerGeo.countryCode;
    let city = headerGeo.city;
    let latitude = headerGeo.latitude;
    let longitude = headerGeo.longitude;

    if (!city && !country) {
      const lookup = await getGeolocationFromIP(ip);
      if (lookup) {
        country = lookup.country || country;
        countryCode = lookup.countryCode || countryCode;
        city = lookup.city || city;
        latitude = lookup.latitude || latitude;
        longitude = lookup.longitude || longitude;
      }
    }

    if (!city && !country && latitude == null && longitude == null) {
      return ok({ reason: "no_geo" });
    }

    const ipHash = hashVisitorIp(ip);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const match = await prismaAnalytics.portfolioView.findFirst({
      where: {
        portfolio_owner_id: owner.user_id,
        created_at: { gte: since },
        OR: [
          ...(visitorId ? [{ anonymous_session_id: visitorId }] : []),
          ...(ipHash ? [{ visitor_ip_hash: ipHash }] : []),
        ],
      },
      orderBy: { created_at: "desc" },
      select: { id: true, city: true, country: true },
    });

    if (match) {
      const needsUpdate =
        (!match.city && Boolean(city)) || (!match.country && Boolean(country));
      if (needsUpdate) {
        await prismaAnalytics.portfolioView.update({
          where: { id: match.id },
          data: {
            ...(city ? { city } : {}),
            ...(country ? { country } : {}),
            ...(countryCode ? { country_code: countryCode } : {}),
            ...(latitude != null ? { latitude } : {}),
            ...(longitude != null ? { longitude } : {}),
          },
        });
      }
      return ok({ updated: needsUpdate });
    }

    const locationLabel =
      getLocationString({
        ip,
        country: country ?? "",
        countryCode: countryCode ?? "",
        region: "",
        city: city ?? "",
        latitude: latitude ?? 0,
        longitude: longitude ?? 0,
        timezone: "",
        isp: "",
        org: "",
        as: "",
      }) || null;

    await prismaAnalytics.analytics.create({
      data: {
        user_id: owner.user_id,
        session_id: visitorId || null,
        source: typeof body.pagePath === "string" ? body.pagePath.slice(0, 255) : alias,
        country: country ?? locationLabel,
        ip: null,
        metadata: {
          visitorId: visitorId || null,
          city,
          countryCode,
          latitude,
          longitude,
          kind: "visitor_location",
        },
      },
    });

    return ok({ created: true });
  } catch (err) {
    console.error("[track/visitor-location] failed:", err);
    return ok({ reason: "error" });
  }
}
