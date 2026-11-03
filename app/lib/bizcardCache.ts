/**
 * bizcardCache.ts
 * ───────────────
 * Client-side caching utility for bizcard data to minimize API calls.
 * Stores fetched bizcard info in localStorage with versioning and TTL.
 */

export interface CachedBizcardProfile {
  version: number; // Cache format version
  timestamp: number; // When data was cached (ms since epoch)
  ttl: number; // Time-to-live in milliseconds (default: 1 hour)
  data: Record<string, unknown>; // The actual profile data
}

const CACHE_PREFIX = 'bizcard_profile';
const CACHE_VERSION = 1;
const DEFAULT_TTL = 60 * 60 * 1000; // 1 hour in milliseconds

/**
 * Generate cache key for a specific bizcard ID or URL alias
 */
function getCacheKey(identifier: string): string {
  return `${CACHE_PREFIX}:${identifier}`;
}

/**
 * Store bizcard profile in cache
 */
export function cacheBizcardProfile(
  identifier: string,
  data: Record<string, unknown>,
  ttl: number = DEFAULT_TTL
): void {
  if (typeof localStorage === 'undefined') return;

  try {
    const cached: CachedBizcardProfile = {
      version: CACHE_VERSION,
      timestamp: Date.now(),
      ttl,
      data,
    };
    localStorage.setItem(getCacheKey(identifier), JSON.stringify(cached));
  } catch (error) {
    console.warn('[bizcardCache] Failed to cache profile:', error);
  }
}

/**
 * Retrieve bizcard profile from cache if valid
 */
export function getCachedBizcardProfile(identifier: string): Record<string, unknown> | null {
  if (typeof localStorage === 'undefined') return null;

  try {
    const raw = localStorage.getItem(getCacheKey(identifier));
    if (!raw) return null;

    const cached = JSON.parse(raw) as CachedBizcardProfile;

    // Check version compatibility
    if (cached.version !== CACHE_VERSION) {
      clearBizcardCache(identifier);
      return null;
    }

    // Check TTL expiration
    const now = Date.now();
    if (now - cached.timestamp > cached.ttl) {
      clearBizcardCache(identifier);
      return null;
    }

    return cached.data;
  } catch (error) {
    console.warn('[bizcardCache] Failed to retrieve cached profile:', error);
    return null;
  }
}

/**
 * Clear cache for a specific bizcard
 */
export function clearBizcardCache(identifier: string): void {
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.removeItem(getCacheKey(identifier));
  } catch (error) {
    console.warn('[bizcardCache] Failed to clear cache:', error);
  }
}

/**
 * Clear all bizcard caches
 */
export function clearAllBizcardCaches(): void {
  if (typeof localStorage === 'undefined') return;

  try {
    const keys = Object.keys(localStorage);
    keys.forEach((key) => {
      if (key.startsWith(CACHE_PREFIX)) {
        localStorage.removeItem(key);
      }
    });
  } catch (error) {
    console.warn('[bizcardCache] Failed to clear all caches:', error);
  }
}

/**
 * Check if a cached profile is still valid
 */
export function isCacheValid(identifier: string): boolean {
  return getCachedBizcardProfile(identifier) !== null;
}

/**
 * Get cache metadata (timestamp, TTL remaining)
 */
export function getCacheMetadata(identifier: string): { createdAt: Date; expiresAt: Date } | null {
  if (typeof localStorage === 'undefined') return null;

  try {
    const raw = localStorage.getItem(getCacheKey(identifier));
    if (!raw) return null;

    const cached = JSON.parse(raw) as CachedBizcardProfile;
    const createdAt = new Date(cached.timestamp);
    const expiresAt = new Date(cached.timestamp + cached.ttl);

    return { createdAt, expiresAt };
  } catch {
    return null;
  }
}
