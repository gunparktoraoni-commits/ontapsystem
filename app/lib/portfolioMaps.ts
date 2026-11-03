import type { PortfolioData } from '../types';

const GOOGLE_MAPS_EMBED_API_KEY = 'YOUR_API_KEY';

export function cleanDisplayValue(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  const lower = normalized.toLowerCase();
  if (lower === 'n/a' || lower === 'na' || lower === 'none') return '';
  return normalized;
}

export function buildAddressText(v: PortfolioData['vcard']): string {
  return [
    cleanDisplayValue(v.addressHouseNo),
    cleanDisplayValue(v.addressArea),
    cleanDisplayValue(v.addressBrgy),
    cleanDisplayValue(v.addressCity),
    cleanDisplayValue(v.addressRegion),
    cleanDisplayValue(v.addressZipcode),
  ]
    .filter(Boolean)
    .join(', ');
}

function toHttpUrlIfPossible(rawValue: string): string {
  const value = cleanDisplayValue(rawValue);
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(value)) return `https://${value}`;
  return '';
}

export function toMapsHref(rawLink: string, fallbackAddress: string): string {
  const mapValue = cleanDisplayValue(rawLink);
  if (mapValue) {
    const directUrl = toHttpUrlIfPossible(mapValue);
    if (directUrl) return directUrl;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapValue)}`;
  }
  if (!fallbackAddress) return '#';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallbackAddress)}`;
}

export function isGoogleMapsUrl(rawLink: string): boolean {
  const directUrl = toHttpUrlIfPossible(rawLink);
  if (!directUrl) return false;

  try {
    const parsed = new URL(directUrl);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    if (host === 'maps.app.goo.gl') return true;
    if (host === 'goo.gl' && path.startsWith('/maps')) return true;
    if (host.startsWith('maps.google.')) return true;
    if (host.endsWith('google.com') && path.includes('/maps')) return true;
    if (host.endsWith('google.com') && (parsed.searchParams.has('q') || parsed.searchParams.has('query') || parsed.searchParams.has('destination'))) return true;

    return false;
  } catch {
    return false;
  }
}

export function extractGoogleMapsQuery(rawLink: string): string {
  const mapValue = cleanDisplayValue(rawLink);
  if (!mapValue) return '';

  const directUrl = toHttpUrlIfPossible(mapValue);
  if (!directUrl) return mapValue;

  try {
    const parsed = new URL(directUrl);

    const queryValue =
      parsed.searchParams.get('q')?.trim() ||
      parsed.searchParams.get('query')?.trim() ||
      parsed.searchParams.get('destination')?.trim() ||
      parsed.searchParams.get('ll')?.trim() ||
      parsed.searchParams.get('daddr')?.trim() ||
      '';

    if (queryValue) return queryValue;

    const segments = parsed.pathname.split('/').filter(Boolean);

    const placeIndex = segments.findIndex((segment) => segment.toLowerCase() === 'place');
    if (placeIndex >= 0 && segments[placeIndex + 1]) {
      return decodeURIComponent(segments[placeIndex + 1]).replace(/\+/g, ' ').trim();
    }

    const searchIndex = segments.findIndex((segment) => segment.toLowerCase() === 'search');
    if (searchIndex >= 0 && segments[searchIndex + 1]) {
      return decodeURIComponent(segments[searchIndex + 1]).replace(/\+/g, ' ').trim();
    }

    const coordinateMatch = parsed.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (coordinateMatch) {
      return `${coordinateMatch[1]},${coordinateMatch[2]}`;
    }

    return directUrl;
  } catch {
    return mapValue;
  }
}

export interface MapCoords {
  latitude: number;
  longitude: number;
}

function isValidCoord(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toValidCoords(lat: number, lng: number): MapCoords | null {
  if (!isValidCoord(lat) || !isValidCoord(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng };
}

/** Open Location Code / plus code (with optional locality suffix). */
export function looksLikePlusCode(raw: string): boolean {
  const value = cleanDisplayValue(raw);
  if (!value) return false;
  return /^[23456789CFGHJMPQRVWX]{4,}\+[23456789CFGHJMPQRVWX]{2,}(?:\s+.+)?$/i.test(value);
}

/**
 * Extract coordinates from a plus code, lat/lng pair, or Google Maps URL.
 * Returns null when the input needs geocoding (e.g. place name / short link without coords).
 */
export function extractCoordsFromMapInput(rawLink: string): MapCoords | null {
  const value = cleanDisplayValue(rawLink);
  if (!value) return null;

  const plain = value.match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (plain) {
    return toValidCoords(Number(plain[1]), Number(plain[2]));
  }

  const directUrl = toHttpUrlIfPossible(value);
  if (!directUrl) return null;

  try {
    const parsed = new URL(directUrl);
    const full = `${parsed.pathname}${parsed.search}${parsed.hash}`;

    const atMatch = full.match(/@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
    if (atMatch) return toValidCoords(Number(atMatch[1]), Number(atMatch[2]));

    const dataMatch = full.match(/!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/);
    if (dataMatch) return toValidCoords(Number(dataMatch[1]), Number(dataMatch[2]));

    for (const key of ['q', 'query', 'll', 'center', 'destination', 'daddr'] as const) {
      const raw = parsed.searchParams.get(key)?.trim() ?? '';
      const coordMatch = raw.match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
      if (coordMatch) return toValidCoords(Number(coordMatch[1]), Number(coordMatch[2]));
    }
  } catch {
    return null;
  }

  return null;
}

/** True when input should drive the live map ahead of typed street address. */
export function isPrioritizedMapInput(rawLink: string): boolean {
  const value = cleanDisplayValue(rawLink);
  if (!value) return false;
  if (looksLikePlusCode(value)) return true;
  if (extractCoordsFromMapInput(value)) return true;
  return isGoogleMapsUrl(value);
}

export const INVALID_GOOGLE_MAPS_LINK_ERROR =
  'Invalid Google Maps link. Please enter a valid link.';

export type ParseGoogleMapsLinkResult =
  | { ok: true; kind: 'empty' }
  | { ok: true; kind: 'coords'; latitude: number; longitude: number; query?: string }
  | { ok: true; kind: 'query'; query: string }
  | { ok: false; error: typeof INVALID_GOOGLE_MAPS_LINK_ERROR };

/**
 * Parse a pasted Google Maps URL (or plus code) into coordinates or a geocode query.
 * Empty input is valid (cleared). Non-maps text that is not a plus code is invalid.
 */
export function parseGoogleMapsLink(raw: string): ParseGoogleMapsLinkResult {
  const value = cleanDisplayValue(raw);
  if (!value) return { ok: true, kind: 'empty' };

  if (looksLikePlusCode(value)) {
    const coords = extractCoordsFromMapInput(value);
    if (coords) {
      return {
        ok: true,
        kind: 'coords',
        latitude: coords.latitude,
        longitude: coords.longitude,
        query: value,
      };
    }
    return { ok: true, kind: 'query', query: value };
  }

  if (!isGoogleMapsUrl(value)) {
    return { ok: false, error: INVALID_GOOGLE_MAPS_LINK_ERROR };
  }

  const coords = extractCoordsFromMapInput(value);
  if (coords) {
    return {
      ok: true,
      kind: 'coords',
      latitude: coords.latitude,
      longitude: coords.longitude,
      query: extractGoogleMapsQuery(value) || undefined,
    };
  }

  const query = extractGoogleMapsQuery(value);
  if (query) {
    return { ok: true, kind: 'query', query };
  }

  return { ok: false, error: INVALID_GOOGLE_MAPS_LINK_ERROR };
}

/** Returns stored lat/long from vcard when both are valid numbers. */
export function resolveStoredPortfolioMapCoords(
  vcard: Pick<PortfolioData['vcard'], 'addressLatitude' | 'addressLongitude'>
): MapCoords | null {
  const latitude = vcard.addressLatitude;
  const longitude = vcard.addressLongitude;
  if (!isValidCoord(latitude) || !isValidCoord(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

/**
 * Resolve map pin coordinates for portfolio themes.
 * Prefers coordinates embedded in the location link; falls back to stored lat/lng
 * when the link is a short URL (or other non-coordinate form) that needs resolving.
 */
export function resolvePortfolioMapCoords(
  vcard: Pick<
    PortfolioData['vcard'],
    'addressLatitude' | 'addressLongitude' | 'addressMapLink'
  >
): MapCoords | null {
  const mapLink = cleanDisplayValue(vcard.addressMapLink);
  if (mapLink) {
    const fromLink = extractCoordsFromMapInput(mapLink);
    if (fromLink) return fromLink;
  }
  return resolveStoredPortfolioMapCoords(vcard);
}

/** True when the portfolio has enough location data to attempt a map / maps link. */
export function hasPortfolioLocation(
  vcard: Pick<
    PortfolioData['vcard'],
    'addressLatitude' | 'addressLongitude' | 'addressMapLink'
  >
): boolean {
  if (cleanDisplayValue(vcard.addressMapLink)) return true;
  return resolveStoredPortfolioMapCoords(vcard) !== null;
}

/** Google Maps navigation URL for a pin and optional address label. */
export function buildGoogleMapsPinHref(opts: {
  latitude?: number | null;
  longitude?: number | null;
  address?: string;
}): string {
  const lat = opts.latitude;
  const lng = opts.longitude;
  const address = cleanDisplayValue(opts.address);

  if (isValidCoord(lat) && isValidCoord(lng)) {
    const coordQuery = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordQuery)}`;
  }

  if (address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  }

  return '#';
}

/** Best Google Maps href for portfolio visitors — prefers the saved location link. */
export function resolveGoogleMapsHref(vcard: PortfolioData['vcard']): string {
  const mapLink = cleanDisplayValue(vcard.addressMapLink);
  if (mapLink) {
    return toMapsHref(mapLink, '');
  }

  const coords = resolveStoredPortfolioMapCoords(vcard);
  const address = buildAddressText(vcard);

  if (coords) {
    return buildGoogleMapsPinHref({
      latitude: coords.latitude,
      longitude: coords.longitude,
      address: address || undefined,
    });
  }

  return buildGoogleMapsPinHref({ address: address || undefined });
}

export function toEmbedMapsSrc(rawLink: string): string {
  const mapValue = cleanDisplayValue(rawLink);
  if (!mapValue) return '';

  // Prefer a searchable query; for short links this falls back to the URL itself,
  // which Google Maps embed can still resolve inside the iframe.
  const mapQuery = extractGoogleMapsQuery(mapValue) || mapValue;
  if (!mapQuery) return '';

  const hasRealEmbedApiKey = Boolean(
    cleanDisplayValue(GOOGLE_MAPS_EMBED_API_KEY)
    && GOOGLE_MAPS_EMBED_API_KEY !== 'YOUR_API_KEY'
  );

  if (hasRealEmbedApiKey) {
    return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(GOOGLE_MAPS_EMBED_API_KEY)}&q=${encodeURIComponent(mapQuery)}`;
  }

  return `https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`;
}
