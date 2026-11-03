// ──────────────────────────────────────────────────────────────
// IP Geolocation Service
// ──────────────────────────────────────────────────────────────
// Provides IP-based geolocation functionality for user tracking
// Integrates with ip-api.com free service with rate limiting
// Includes caching and fallback mechanisms
// ──────────────────────────────────────────────────────────────

export interface GeolocationData {
  ip: string;
  country: string;
  countryCode: string;
  region: string;
  city: string;
  latitude: number;
  longitude: number;
  timezone: string;
  isp: string;
  org: string;
  as: string;
}

export interface GeolocationError {
  code: string;
  message: string;
  rateLimited?: boolean;
}

// Cache for geolocation results (TTL: 24 hours)
const geolocationCache = new Map<string, { data: GeolocationData; expires: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Rate limiting for API calls
const API_CALLS = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_CALLS_PER_MINUTE = 45; // ip-api.com free tier limit

/**
 * Get geolocation data from IP address
 * Uses ip-api.com free service with caching and rate limiting
 */
export async function getGeolocationFromIP(ip: string): Promise<GeolocationData | null> {
  // Validate IP address
  if (!isValidIPAddress(ip)) {
    return null;
  }

  // Check cache first
  const cached = getCachedGeolocation(ip);
  if (cached) {
    return cached;
  }

  // Check rate limiting
  if (isRateLimited()) {
    console.warn('Geolocation service rate limit exceeded');
    return null;
  }

  try {
    const response = await fetchGeolocationFromAPI(ip);
    
    if (response && response.status === 'success') {
      const geoData: GeolocationData = {
        ip: response.query,
        country: response.country || '',
        countryCode: response.countryCode || '',
        region: response.regionName || '',
        city: response.city || '',
        latitude: response.lat || 0,
        longitude: response.lon || 0,
        timezone: response.timezone || '',
        isp: response.isp || '',
        org: response.org || '',
        as: response.as || ''
      };

      // Cache the result
      cacheGeolocation(ip, geoData);
      
      return geoData;
    } else {
      console.warn('Geolocation lookup failed:', response?.message || 'Unknown error');
      return null;
    }
  } catch (error) {
    console.error('Geolocation service error:', error);
    return null;
  }
}

/**
 * Fetch geolocation data from ip-api.com
 */
async function fetchGeolocationFromAPI(ip: string): Promise<any> {
  const url = `http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,regionName,city,lat,lon,timezone,isp,org,as,query`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'ONTAP-System/1.0',
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(5000) // 5 second timeout
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  
  // Track API call for rate limiting
  trackAPICall();
  
  return data;
}

/**
 * Validate IPv4 or IPv6 address
 */
function isValidIPAddress(ip: string): boolean {
  // IPv4 regex
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  
  // IPv6 regex (simplified)
  const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
  
  // Handle common special cases
  if (ip === 'localhost' || ip === '127.0.0.1' || ip === '::1') {
    return false;
  }
  
  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}

/**
 * Get cached geolocation data if not expired
 */
function getCachedGeolocation(ip: string): GeolocationData | null {
  const cached = geolocationCache.get(ip);
  
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }
  
  if (cached) {
    geolocationCache.delete(ip);
  }
  
  return null;
}

/**
 * Cache geolocation data with TTL
 */
function cacheGeolocation(ip: string, data: GeolocationData): void {
  geolocationCache.set(ip, {
    data,
    expires: Date.now() + CACHE_TTL_MS
  });

  // Clean up expired entries periodically
  if (geolocationCache.size > 1000) {
    cleanupExpiredCache();
  }
}

/**
 * Clean up expired cache entries
 */
function cleanupExpiredCache(): void {
  const now = Date.now();
  
  for (const [key, value] of geolocationCache.entries()) {
    if (value.expires <= now) {
      geolocationCache.delete(key);
    }
  }
}

/**
 * Check if API calls are rate limited
 */
function isRateLimited(): boolean {
  const now = Date.now();
  const current = API_CALLS.get('global');
  
  if (!current || now > current.resetTime) {
    API_CALLS.set('global', { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return false;
  }
  
  if (current.count >= MAX_CALLS_PER_MINUTE) {
    return true;
  }
  
  current.count++;
  return false;
}

/**
 * Track API call for rate limiting
 */
function trackAPICall(): void {
  const now = Date.now();
  const current = API_CALLS.get('global');
  
  if (current && now <= current.resetTime) {
    current.count++;
  }
}

/**
 * Get location string from geolocation data
 */
export function getLocationString(geoData: GeolocationData): string {
  const parts = [];
  
  if (geoData.city) {
    parts.push(geoData.city);
  }
  
  if (geoData.region && geoData.region !== geoData.city) {
    parts.push(geoData.region);
  }
  
  if (geoData.country) {
    parts.push(geoData.country);
  }
  
  return parts.join(', ') || '';
}

/**
 * Resolve login geolocation from an IP address with optional header-based fallback.
 */
export async function resolveLoginGeoFromIp(
  ip: string,
  fallback?: {
    location?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  }
): Promise<{
  location: string | null;
  latitude: number | null;
  longitude: number | null;
}> {
  const geoData = await getGeolocationFromIP(ip);

  if (geoData) {
    const location = getLocationString(geoData).trim();
    const coords = getCoordinates(geoData);

    return {
      location: location || fallback?.location?.trim() || null,
      latitude: coords.latitude ?? fallback?.latitude ?? null,
      longitude: coords.longitude ?? fallback?.longitude ?? null,
    };
  }

  const fallbackLocation = fallback?.location?.trim();
  return {
    location: fallbackLocation || null,
    latitude: fallback?.latitude ?? null,
    longitude: fallback?.longitude ?? null,
  };
}

/**
 * Get coordinates from geolocation data
 */
export function getCoordinates(geoData: GeolocationData): { latitude: number; longitude: number } {
  return {
    latitude: geoData.latitude,
    longitude: geoData.longitude
  };
}

/**
 * Check if geolocation data is valid
 */
export function isValidGeolocationData(data: any): data is GeolocationData {
  return (
    data &&
    typeof data.ip === 'string' &&
    typeof data.country === 'string' &&
    typeof data.city === 'string' &&
    typeof data.latitude === 'number' &&
    typeof data.longitude === 'number' &&
    data.latitude >= -90 && data.latitude <= 90 &&
    data.longitude >= -180 && data.longitude <= 180
  );
}

/**
 * Get timezone from geolocation data
 */
export function getTimezone(geoData: GeolocationData): string {
  return geoData.timezone || 'UTC';
}

/**
 * Get country info from geolocation data
 */
export function getCountryInfo(geoData: GeolocationData): {
  country: string;
  countryCode: string;
} {
  return {
    country: geoData.country || 'Unknown',
    countryCode: geoData.countryCode || 'XX'
  };
}

/**
 * Batch geolocation lookup for multiple IPs
 * Respects rate limiting and uses caching
 */
export async function batchGeolocationLookup(
  ips: string[]
): Promise<Map<string, GeolocationData | null>> {
  const results = new Map<string, GeolocationData | null>();
  
  // Process in batches to respect rate limits
  const batchSize = 10;
  const batches = [];
  
  for (let i = 0; i < ips.length; i += batchSize) {
    batches.push(ips.slice(i, i + batchSize));
  }
  
  for (const batch of batches) {
    const batchPromises = batch.map(async (ip) => {
      const geoData = await getGeolocationFromIP(ip);
      return { ip, geoData };
    });
    
    const batchResults = await Promise.allSettled(batchPromises);
    
    batchResults.forEach((result, index) => {
      const ip = batch[index];
      if (result.status === 'fulfilled') {
        results.set(ip, result.value.geoData);
      } else {
        console.error(`Failed to lookup geolocation for ${ip}:`, result.reason);
        results.set(ip, null);
      }
    });
    
    // Add delay between batches to respect rate limits
    if (batches.indexOf(batch) < batches.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return results;
}

/**
 * Clear geolocation cache (useful for testing or forced refresh)
 */
export function clearGeolocationCache(): void {
  geolocationCache.clear();
  API_CALLS.clear();
}

/**
 * Get cache statistics
 */
export function getGeolocationCacheStats(): {
  cacheSize: number;
  rateLimitStatus: { remainingCalls: number; resetTime: number | null };
} {
  const now = Date.now();
  const current = API_CALLS.get('global');
  
  return {
    cacheSize: geolocationCache.size,
    rateLimitStatus: {
      remainingCalls: current ? Math.max(0, MAX_CALLS_PER_MINUTE - current.count) : MAX_CALLS_PER_MINUTE,
      resetTime: current ? current.resetTime : null
    }
  };
}
