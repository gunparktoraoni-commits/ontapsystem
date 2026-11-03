import { NextRequest, NextResponse } from "next/server";
import {
  buildAddressSearchQuery,
  decimalToCoordinate,
  geocodeAddressParts,
  geocodeAddressQuery,
  reverseGeocodeCoordinates,
  type AddressGeocodeParts,
} from "@/server/lib/geocoding";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, getUserAgent, resolveRequestSession } from "@/server/lib/auth";

function sanitizeQueryParam(value: string | null): string {
  if (!value) return "";
  // Allow full Google Maps short/long URLs (plus place queries) through to the geocoder.
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim().slice(0, 1024);
}

function jsonError(
  status: number,
  code: string,
  message: string,
  tag: string = "[GEOCODE_API]"
) {
  return NextResponse.json({ error: message, code, tag }, { status });
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  const rateCheck = checkRateLimit("geocode", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        error: "Too many geocode requests. Please try again later.",
        code: "GEOCODE_RATE_LIMITED",
        tag: "[GEOCODE_API]",
      },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
      }
    );
  }

  const resolved = await resolveRequestSession(request);
  if (!resolved.session) {
    return jsonError(401, "GEOCODE_UNAUTHORIZED", "Unauthorized.");
  }

  const { searchParams } = request.nextUrl;
  const lat = decimalToCoordinate(searchParams.get("lat"));
  const lng = decimalToCoordinate(
    searchParams.get("lng") ?? searchParams.get("lon") ?? searchParams.get("longitude")
  );

  // Reverse geocode mode: lat + lng
  if (lat != null || lng != null) {
    if (lat == null || lng == null) {
      return jsonError(
        422,
        "GEOCODE_INVALID_COORDINATES",
        "Both lat and lng are required for reverse geocoding."
      );
    }

    try {
      const result = await reverseGeocodeCoordinates(lat, lng);
      if (!result) {
        return jsonError(404, "GEOCODE_REVERSE_NOT_FOUND", "No address found for these coordinates.");
      }

      return NextResponse.json({
        latitude: result.latitude,
        longitude: result.longitude,
        displayName: result.displayName,
        region: result.region ?? null,
        city: result.city ?? null,
        barangay: result.barangay ?? null,
        suburb: result.suburb ?? null,
        area: result.area ?? null,
        houseNumber: result.houseNumber ?? null,
        zipcode: result.zipcode ?? result.postcode ?? null,
        mode: "reverse",
      });
    } catch (error) {
      console.error("[GEOCODE_API] Reverse geocode error:", { ip, ua, error });
      return jsonError(502, "GEOCODE_REVERSE_SERVICE_ERROR", "Reverse geocoding service unavailable. Please try again.");
    }
  }

  const q = sanitizeQueryParam(searchParams.get("q"));
  const parts: AddressGeocodeParts = {
    area: sanitizeQueryParam(searchParams.get("area")),
    brgy: sanitizeQueryParam(searchParams.get("brgy")),
    city: sanitizeQueryParam(searchParams.get("city")),
    region: sanitizeQueryParam(searchParams.get("region")),
    zipcode: sanitizeQueryParam(searchParams.get("zipcode")),
  };

  const query = q || buildAddressSearchQuery(parts);
  if (!query || query.length < 3) {
    return jsonError(422, "GEOCODE_INVALID_QUERY", "A city, plus code, map query, or full address is required.");
  }

  const city = sanitizeQueryParam(parts.city ?? null);
  const looksLikePlusCodeOrCoords =
    /^[23456789CFGHJMPQRVWX]{4,}\+[23456789CFGHJMPQRVWX]{2,}/i.test(query) ||
    /^-?\d{1,2}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?$/.test(query) ||
    /maps\.google|google\.com\/maps|goo\.gl\/maps|maps\.app\.goo\.gl/i.test(query);

  if (!city && !looksLikePlusCodeOrCoords && query.length < 5) {
    return jsonError(422, "GEOCODE_CITY_REQUIRED", "City is required for address lookup.");
  }

  try {
    // Prefer explicit `q` (plus code / map query / pasted coords) when provided.
    let result = q ? await geocodeAddressQuery(q) : null;
    if (!result && city) {
      result = await geocodeAddressParts(parts);
    }
    if (!result && !q) {
      result = await geocodeAddressQuery(query);
    }

    if (!result) {
      return jsonError(404, "GEOCODE_NOT_FOUND", "No location found for this address.");
    }

    return NextResponse.json({
      latitude: result.latitude,
      longitude: result.longitude,
      displayName: result.displayName,
      zipcode: result.zipcode ?? null,
      mode: "forward",
    });
  } catch (error) {
    console.error("[GEOCODE_API] Forward geocode error:", { ip, ua, error });
    return jsonError(502, "GEOCODE_SERVICE_ERROR", "Geocoding service unavailable. Please try again.");
  }
}
