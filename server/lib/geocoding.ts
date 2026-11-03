export interface GeocodeResult {
  latitude: number;
  longitude: number;
  displayName: string;
  zipcode?: string;
}

export interface ReverseGeocodeResult extends GeocodeResult {
  region?: string;
  city?: string;
  barangay?: string;
  area?: string;
  houseNumber?: string;
  suburb?: string;
  postcode?: string;
}

export interface AddressGeocodeParts {
  area?: string | null;
  brgy?: string | null;
  city?: string | null;
  region?: string | null;
  zipcode?: string | null;
}

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const MAX_QUERY_LENGTH = 512;
const MAX_AREA_STRIP_STEPS = 20;

function sanitizePart(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
}

export function buildAddressSearchQuery(parts: AddressGeocodeParts): string {
  const segments = [
    sanitizePart(parts.area),
    sanitizePart(parts.brgy),
    sanitizePart(parts.city),
    sanitizePart(parts.region),
    sanitizePart(parts.zipcode),
  ].filter(Boolean);

  const query = segments.join(", ");
  return query.length > MAX_QUERY_LENGTH ? query.slice(0, MAX_QUERY_LENGTH) : query;
}

export function decimalToCoordinate(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function geocodeUserAgent(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.FRONTEND_URL ?? "";
  const appName = process.env.EMAIL_FROM_NAME ?? "OnTap";
  if (appUrl) return `${appName} (${appUrl})`;
  return `${appName} geocoder`;
}

function normalizeAreaForFallback(area: string): string {
  return area
    .replace(/\b(blk|block|lot|lt|brgy|barangay|subdivision|subd|phase|zone|village|vill)\b/gi, "")
    .replace(/[,\-\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip leading tokens one-by-one from a street/area string. */
export function generateAreaStripVariants(area: string, maxSteps: number = MAX_AREA_STRIP_STEPS): string[] {
  const trimmed = sanitizePart(area);
  if (!trimmed) return [""];

  const tokens = trimmed.split(/\s+/);
  const variants: string[] = [];
  const limit = Math.min(tokens.length, Math.max(1, maxSteps));

  for (let i = 0; i < limit; i++) {
    const remaining = tokens.slice(i).join(" ");
    if (remaining && !variants.includes(remaining)) variants.push(remaining);
  }

  const normalized = normalizeAreaForFallback(trimmed);
  if (normalized && !variants.includes(normalized)) variants.push(normalized);

  if (!variants.includes("")) variants.push("");
  return variants;
}

function buildProgressiveQueries(parts: AddressGeocodeParts): string[] {
  const city = sanitizePart(parts.city);
  const region = sanitizePart(parts.region);
  const zipcode = sanitizePart(parts.zipcode);
  const brgy = sanitizePart(parts.brgy);
  const area = sanitizePart(parts.area);

  const queries: string[] = [];
  const addQuery = (segments: Array<string | null | undefined>) => {
    const query = segments.filter(Boolean).join(", ");
    if (query && !queries.includes(query)) queries.push(query);
  };

  for (const areaVariant of generateAreaStripVariants(area)) {
    addQuery([areaVariant, brgy, city, region, zipcode]);
  }

  addQuery([brgy, city, region, zipcode]);
  addQuery([city, region, zipcode]);
  addQuery([city, region]);
  addQuery([city, "Philippines"]);
  return queries;
}

type NominatimSearchHit = {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: {
    postcode?: string;
  };
};

type NominatimReverseHit = {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: {
    road?: string;
    pedestrian?: string;
    house_number?: string;
    neighbourhood?: string;
    suburb?: string;
    village?: string;
    hamlet?: string;
    quarter?: string;
    city_district?: string;
    city?: string;
    town?: string;
    municipality?: string;
    county?: string;
    state?: string;
    region?: string;
    postcode?: string;
  };
};

function parseLatLng(latRaw: unknown, lonRaw: unknown): { latitude: number; longitude: number } | null {
  const latitude = Number(latRaw);
  const longitude = Number(lonRaw);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

const GOOGLE_MAPS_BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function looksLikeGoogleMapsUrl(value: string): boolean {
  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (host === "maps.app.goo.gl") return true;
    if (host === "goo.gl" && path.startsWith("/maps")) return true;
    if (host.startsWith("maps.google.")) return true;
    if (host.endsWith("google.com") && path.includes("/maps")) return true;
    return false;
  } catch {
    return false;
  }
}

function extractCoordsFromMapsUrl(urlString: string): { latitude: number; longitude: number } | null {
  try {
    const parsed = new URL(urlString);
    const full = `${parsed.pathname}${parsed.search}${parsed.hash}`;

    const atMatch = full.match(/@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
    if (atMatch) return parseLatLng(atMatch[1], atMatch[2]);

    // Prefer place marker coords (!3d lat !4d lng) over viewport center (!2d lng !3d lat).
    const dataMatch = full.match(/!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/);
    if (dataMatch) return parseLatLng(dataMatch[1], dataMatch[2]);

    for (const key of ["q", "query", "ll", "center", "destination", "daddr"] as const) {
      const raw = parsed.searchParams.get(key)?.trim() ?? "";
      const coordMatch = raw.match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
      if (coordMatch) return parseLatLng(coordMatch[1], coordMatch[2]);
    }
  } catch {
    return null;
  }
  return null;
}

/** Extract the first plausible lat/lng pair from Google Maps HTML / preview payloads. */
function extractCoordsFromMapsHtml(html: string): { latitude: number; longitude: number } | null {
  if (!html) return null;

  const atMatch = html.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
  if (atMatch) {
    const coords = parseLatLng(atMatch[1], atMatch[2]);
    if (coords) return coords;
  }

  const markerMatch = html.match(/\[null,null,(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)\]/);
  if (markerMatch) {
    const coords = parseLatLng(markerMatch[1], markerMatch[2]);
    if (coords) return coords;
  }

  const dataMatch = html.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  if (dataMatch) {
    const coords = parseLatLng(dataMatch[1], dataMatch[2]);
    if (coords) return coords;
  }

  return null;
}

function extractPreviewPlacePath(html: string): string | null {
  const hrefMatch = html.match(/href="(\/maps\/preview\/place\?[^"]+)"/i);
  if (!hrefMatch?.[1]) return null;
  return hrefMatch[1].replace(/&amp;/g, "&");
}

function extractQueryFromMapsUrl(urlString: string): string {
  try {
    const parsed = new URL(urlString);

    const queryValue =
      parsed.searchParams.get("q")?.trim() ||
      parsed.searchParams.get("query")?.trim() ||
      parsed.searchParams.get("destination")?.trim() ||
      parsed.searchParams.get("ll")?.trim() ||
      parsed.searchParams.get("daddr")?.trim() ||
      "";

    if (queryValue) return queryValue;

    const segments = parsed.pathname.split("/").filter(Boolean);
    const placeIndex = segments.findIndex((segment) => segment.toLowerCase() === "place");
    if (placeIndex >= 0 && segments[placeIndex + 1]) {
      return decodeURIComponent(segments[placeIndex + 1]).replace(/\+/g, " ").trim();
    }

    const searchIndex = segments.findIndex((segment) => segment.toLowerCase() === "search");
    if (searchIndex >= 0 && segments[searchIndex + 1]) {
      return decodeURIComponent(segments[searchIndex + 1]).replace(/\+/g, " ").trim();
    }

    const coordinateMatch = parsed.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (coordinateMatch) {
      return `${coordinateMatch[1]},${coordinateMatch[2]}`;
    }
  } catch {
    return "";
  }
  return "";
}

/**
 * Follow Google Maps short-link redirects and extract coords or a place query.
 * Short links (maps.app.goo.gl) usually only expose a place name after redirect;
 * we also fetch Google's /maps/preview/place payload when needed for exact pins.
 */
async function resolveGoogleMapsUrl(rawUrl: string): Promise<{
  coords: { latitude: number; longitude: number } | null;
  query: string;
}> {
  const directUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  let resolvedUrl = directUrl;
  let html = "";

  try {
    const response = await fetch(directUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": GOOGLE_MAPS_BROWSER_UA,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (response.url) resolvedUrl = response.url;
    html = await response.text();
  } catch {
    // Fall through and parse the original URL as-is.
  }

  let coords =
    extractCoordsFromMapsUrl(resolvedUrl) || extractCoordsFromMapsUrl(directUrl);

  if (!coords && html) {
    coords = extractCoordsFromMapsHtml(html);

    if (!coords) {
      const previewPath = extractPreviewPlacePath(html);
      if (previewPath) {
        try {
          const previewUrl = new URL(previewPath, "https://www.google.com").toString();
          const previewResponse = await fetch(previewUrl, {
            method: "GET",
            redirect: "follow",
            headers: {
              Accept: "text/html,application/xhtml+xml",
              "User-Agent": GOOGLE_MAPS_BROWSER_UA,
              Referer: resolvedUrl,
            },
            signal: AbortSignal.timeout(8000),
          });
          const previewHtml = await previewResponse.text();
          coords =
            extractCoordsFromMapsHtml(previewHtml) ||
            extractCoordsFromMapsUrl(previewResponse.url || previewUrl);
        } catch {
          // Keep query-based fallback below.
        }
      }
    }
  }

  const query =
    extractQueryFromMapsUrl(resolvedUrl) ||
    extractQueryFromMapsUrl(directUrl) ||
    "";

  return { coords, query };
}

/** Progressive Nominatim queries for Google place strings (business, street, city…). */
function buildMapsPlaceQueryVariants(query: string): string[] {
  const normalized = query.trim();
  if (!normalized) return [];

  const variants: string[] = [normalized];
  const segments = normalized
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  for (let i = 1; i < segments.length; i++) {
    const candidate = segments.slice(i).join(", ");
    if (candidate && !variants.includes(candidate)) variants.push(candidate);
  }

  // Drop ZIP-only trailing tokens when we still have street + city.
  if (segments.length >= 3) {
    const withoutZip = segments
      .filter((segment, index) => !(index === segments.length - 1 && /^\d{4,}$/.test(segment)))
      .join(", ");
    if (withoutZip && !variants.includes(withoutZip)) variants.push(withoutZip);
  }

  return variants;
}

async function nominatimSearch(query: string): Promise<GeocodeResult | null> {
  const normalized = query.trim();
  if (!normalized || normalized.length < 3) return null;

  const params = new URLSearchParams({
    q: normalized,
    format: "json",
    limit: "1",
    addressdetails: "1",
    countrycodes: "ph",
  });

  const response = await fetch(`${NOMINATIM_SEARCH_URL}?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": geocodeUserAgent(),
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as NominatimSearchHit[];
  const first = payload[0];
  if (!first) return null;

  const coords = parseLatLng(first.lat, first.lon);
  if (!coords) return null;

  const postcode = sanitizePart(first.address?.postcode);
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    displayName: typeof first.display_name === "string" ? first.display_name : normalized,
    zipcode: /^\d{4}$/.test(postcode) ? postcode : undefined,
  };
}

export async function geocodeAddressQuery(query: string): Promise<GeocodeResult | null> {
  const normalized = query.trim();
  if (!normalized || normalized.length < 3) return null;

  // Resolve Google Maps short/full URLs before Nominatim search.
  if (looksLikeGoogleMapsUrl(normalized)) {
    const resolved = await resolveGoogleMapsUrl(normalized);
    if (resolved.coords) {
      return {
        latitude: resolved.coords.latitude,
        longitude: resolved.coords.longitude,
        displayName: resolved.query || `${resolved.coords.latitude},${resolved.coords.longitude}`,
      };
    }
    if (resolved.query && resolved.query !== normalized && !looksLikeGoogleMapsUrl(resolved.query)) {
      for (const variant of buildMapsPlaceQueryVariants(resolved.query)) {
        const result = await nominatimSearch(variant);
        if (result) return result;
      }
      return null;
    }
  }

  for (const variant of buildMapsPlaceQueryVariants(normalized)) {
    const result = await nominatimSearch(variant);
    if (result) return result;
  }

  return null;
}

export async function geocodeAddressParts(parts: AddressGeocodeParts): Promise<GeocodeResult | null> {
  const city = sanitizePart(parts.city);
  if (!city) return null;

  const queries = buildProgressiveQueries(parts);
  for (const query of queries) {
    const result = await geocodeAddressQuery(query);
    if (result) return result;
  }

  return null;
}

/**
 * Reverse-geocode coordinates to a Philippine address breakdown.
 */
export async function reverseGeocodeCoordinates(
  latitude: number,
  longitude: number
): Promise<ReverseGeocodeResult | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    format: "json",
    addressdetails: "1",
    zoom: "18",
  });

  const response = await fetch(`${NOMINATIM_REVERSE_URL}?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": geocodeUserAgent(),
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as NominatimReverseHit;
  const coords = parseLatLng(payload.lat ?? latitude, payload.lon ?? longitude);
  if (!coords) return null;

  const address = payload.address ?? {};
  const city =
    sanitizePart(address.city) ||
    sanitizePart(address.town) ||
    sanitizePart(address.municipality) ||
    sanitizePart(address.county);

  const barangay =
    sanitizePart(address.suburb) ||
    sanitizePart(address.village) ||
    sanitizePart(address.neighbourhood) ||
    sanitizePart(address.quarter) ||
    sanitizePart(address.hamlet) ||
    sanitizePart(address.city_district);

  const road = sanitizePart(address.road) || sanitizePart(address.pedestrian);
  const houseNumber = sanitizePart(address.house_number);
  const area = [houseNumber, road].filter(Boolean).join(" ").trim() || sanitizePart(address.neighbourhood);

  const region = sanitizePart(address.state) || sanitizePart(address.region);
  const postcode = sanitizePart(address.postcode);

  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    displayName: typeof payload.display_name === "string" ? payload.display_name : `${latitude},${longitude}`,
    region: region || undefined,
    city: city || undefined,
    barangay: barangay || undefined,
    area: area || undefined,
    houseNumber: houseNumber || undefined,
    suburb: barangay || undefined,
    postcode: /^\d{4}$/.test(postcode) ? postcode : undefined,
    zipcode: /^\d{4}$/.test(postcode) ? postcode : undefined,
  };
}
