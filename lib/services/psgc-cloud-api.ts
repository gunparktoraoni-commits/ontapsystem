/**
 * PSGC Cloud API Service Module
 *
 * Integrates with https://psgc.cloud for Philippine geographic data
 * (regions, cities/municipalities, barangays).
 *
 * - Public API (no auth)
 * - In-memory cache (24h TTL)
 * - Structured errors with tags
 * - Hierarchical fetch: region → city/municipality → barangay
 */

const PSGC_CLOUD_BASE_URL = 'https://psgc.cloud/api';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

class PSGCCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private readonly TTL_MS = 24 * 60 * 60 * 1000;

  set<T>(key: string, data: T): void {
    const now = Date.now();
    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + this.TTL_MS,
    });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  clear(): void {
    this.cache.clear();
  }
}

const cache = new PSGCCache();

export interface PSGCRegion {
  code: string;
  name: string;
}

export interface PSGCCity {
  code: string;
  name: string;
  type: string;
  district?: string;
  zip_code?: string;
}

export interface PSGCBarangay {
  code: string;
  name: string;
  status?: string;
}

export class PSGCCloudError extends Error {
  code: string;
  tag: string;
  status: number;

  constructor(code: string, tag: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.tag = tag;
    this.status = status;
    this.name = 'PSGCCloudError';
  }
}

async function fetchWithTimeout(
  url: string,
  timeout: number = 12000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

function unwrapListPayload<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.data)) return record.data as T[];
    if (Array.isArray(record.value)) return record.value as T[];
  }
  return [];
}

function normalizeCity(raw: Partial<PSGCCity>): PSGCCity | null {
  const code = typeof raw.code === 'string' ? raw.code.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!code || !name) return null;
  return {
    code,
    name,
    type: typeof raw.type === 'string' ? raw.type.trim() : 'City',
    district: typeof raw.district === 'string' ? raw.district.trim() : undefined,
    zip_code:
      typeof raw.zip_code === 'string' && raw.zip_code.trim()
        ? raw.zip_code.trim()
        : undefined,
  };
}

function normalizeBarangay(raw: Partial<PSGCBarangay>): PSGCBarangay | null {
  const code = typeof raw.code === 'string' ? raw.code.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!code || !name) return null;
  return {
    code,
    name,
    status: typeof raw.status === 'string' ? raw.status : undefined,
  };
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

function regionPrefix(regionCode: string): string {
  return regionCode.slice(0, 2);
}

/**
 * Fetch all regions from PSGC Cloud API.
 */
export async function fetchRegions(): Promise<PSGCRegion[]> {
  const cacheKey = 'psgc:regions:all';
  const cached = cache.get<PSGCRegion[]>(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetchWithTimeout(`${PSGC_CLOUD_BASE_URL}/regions`);

    if (!response.ok) {
      throw new PSGCCloudError(
        'REGIONS_FETCH_FAILED',
        '[PSGC_REGIONS_API]',
        `Failed to fetch regions: HTTP ${response.status}`,
        response.status
      );
    }

    const regions = unwrapListPayload<PSGCRegion>(await response.json())
      .map((region) => ({
        code: String(region.code ?? '').trim(),
        name: String(region.name ?? '').trim(),
      }))
      .filter((region) => region.code && region.name);

    if (regions.length === 0) {
      throw new PSGCCloudError(
        'REGIONS_INVALID_RESPONSE',
        '[PSGC_REGIONS_API]',
        'Invalid response format: expected array of regions',
        500
      );
    }

    const sorted = sortByName(regions);
    cache.set(cacheKey, sorted);
    return sorted;
  } catch (error) {
    if (error instanceof PSGCCloudError) throw error;

    if (error instanceof Error && error.name === 'AbortError') {
      throw new PSGCCloudError(
        'REGIONS_TIMEOUT',
        '[PSGC_REGIONS_API]',
        'Request timeout while fetching regions',
        504
      );
    }

    throw new PSGCCloudError(
      'REGIONS_NETWORK_ERROR',
      '[PSGC_REGIONS_API]',
      `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
  }
}

/**
 * Fetch cities and municipalities for a region.
 * Prefers PSGC v2 nested path (correctly scoped by region).
 */
export async function fetchCitiesByRegion(regionCode: string): Promise<PSGCCity[]> {
  if (!regionCode || typeof regionCode !== 'string' || !/^\d{10}$/.test(regionCode)) {
    throw new PSGCCloudError(
      'CITIES_INVALID_REGION_CODE',
      '[PSGC_CITIES_API]',
      'Region code is required and must be a 10-digit string',
      400
    );
  }

  const cacheKey = `psgc:cities:region:${regionCode}`;
  const cached = cache.get<PSGCCity[]>(cacheKey);
  if (cached) return cached;

  try {
    const v2Url = `${PSGC_CLOUD_BASE_URL}/v2/regions/${encodeURIComponent(regionCode)}/cities-municipalities`;
    const v2Response = await fetchWithTimeout(v2Url);

    if (v2Response.ok) {
      const cities = sortByName(
        unwrapListPayload<Partial<PSGCCity>>(await v2Response.json())
          .map(normalizeCity)
          .filter((city): city is PSGCCity => city !== null)
      );
      cache.set(cacheKey, cities);
      return cities;
    }

    // Fallback: merge cities + municipalities and filter by region prefix.
    // Legacy filterBy=region is unreliable on psgc.cloud and may return the full catalog.
    const prefix = regionPrefix(regionCode);
    const [citiesRes, munisRes] = await Promise.all([
      fetchWithTimeout(`${PSGC_CLOUD_BASE_URL}/cities`),
      fetchWithTimeout(`${PSGC_CLOUD_BASE_URL}/municipalities`),
    ]);

    if (!citiesRes.ok && !munisRes.ok) {
      throw new PSGCCloudError(
        'CITIES_FETCH_FAILED',
        '[PSGC_CITIES_API]',
        `Failed to fetch cities for region ${regionCode}: HTTP ${v2Response.status}`,
        v2Response.status || 502
      );
    }

    const citiesRaw = citiesRes.ok
      ? unwrapListPayload<Partial<PSGCCity>>(await citiesRes.json())
      : [];
    const munisRaw = munisRes.ok
      ? unwrapListPayload<Partial<PSGCCity>>(await munisRes.json())
      : [];

    const byCode = new Map<string, PSGCCity>();
    for (const raw of [...citiesRaw, ...munisRaw]) {
      const city = normalizeCity(raw);
      if (!city) continue;
      if (!city.code.startsWith(prefix)) continue;
      byCode.set(city.code, city);
    }

    const cities = sortByName(Array.from(byCode.values()));
    cache.set(cacheKey, cities);
    return cities;
  } catch (error) {
    if (error instanceof PSGCCloudError) throw error;

    if (error instanceof Error && error.name === 'AbortError') {
      throw new PSGCCloudError(
        'CITIES_TIMEOUT',
        '[PSGC_CITIES_API]',
        `Request timeout while fetching cities for region ${regionCode}`,
        504
      );
    }

    throw new PSGCCloudError(
      'CITIES_NETWORK_ERROR',
      '[PSGC_CITIES_API]',
      `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
  }
}

/**
 * Fetch barangays for a city or municipality.
 * Uses hierarchy endpoints (filterBy=city is unreliable / often 500).
 */
export async function fetchBarangaysByCity(cityCode: string): Promise<PSGCBarangay[]> {
  if (!cityCode || typeof cityCode !== 'string' || !/^\d{10}$/.test(cityCode)) {
    throw new PSGCCloudError(
      'BARANGAYS_INVALID_CITY_CODE',
      '[PSGC_BARANGAYS_API]',
      'City code is required and must be a 10-digit string',
      400
    );
  }

  const cacheKey = `psgc:barangays:city:${cityCode}`;
  const cached = cache.get<PSGCBarangay[]>(cacheKey);
  if (cached) return cached;

  try {
    const endpoints = [
      `${PSGC_CLOUD_BASE_URL}/cities/${encodeURIComponent(cityCode)}/barangays`,
      `${PSGC_CLOUD_BASE_URL}/municipalities/${encodeURIComponent(cityCode)}/barangays`,
    ];

    let lastStatus = 0;
    for (const url of endpoints) {
      const response = await fetchWithTimeout(url);
      lastStatus = response.status;

      if (response.status === 404) continue;
      if (!response.ok) continue;

      const barangays = sortByName(
        unwrapListPayload<Partial<PSGCBarangay>>(await response.json())
          .map(normalizeBarangay)
          .filter((brgy): brgy is PSGCBarangay => brgy !== null)
      );

      cache.set(cacheKey, barangays);
      return barangays;
    }

    // Soft-fail: empty list is preferable to hard errors for incomplete PSGC rows.
    if (lastStatus === 404 || lastStatus === 500 || lastStatus === 0) {
      cache.set(cacheKey, []);
      return [];
    }

    throw new PSGCCloudError(
      'BARANGAYS_FETCH_FAILED',
      '[PSGC_BARANGAYS_API]',
      `Failed to fetch barangays for city ${cityCode}: HTTP ${lastStatus}`,
      lastStatus
    );
  } catch (error) {
    if (error instanceof PSGCCloudError) throw error;

    if (error instanceof Error && error.name === 'AbortError') {
      throw new PSGCCloudError(
        'BARANGAYS_TIMEOUT',
        '[PSGC_BARANGAYS_API]',
        `Request timeout while fetching barangays for city ${cityCode}`,
        504
      );
    }

    throw new PSGCCloudError(
      'BARANGAYS_NETWORK_ERROR',
      '[PSGC_BARANGAYS_API]',
      `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
  }
}

export function clearPSGCCache(): void {
  cache.clear();
}
