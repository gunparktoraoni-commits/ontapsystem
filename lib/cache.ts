import { Redis } from "@upstash/redis";

type CacheValue = unknown;

type MemoryEntry = {
  value: CacheValue;
  expiresAt: number;
};

const memoryStore = new Map<string, MemoryEntry>();

const redisEnabled = Boolean(process.env.UPSTASH_REDIS_URL && process.env.UPSTASH_REDIS_TOKEN);

const redis = redisEnabled
  ? new Redis({
      url: process.env.UPSTASH_REDIS_URL!,
      token: process.env.UPSTASH_REDIS_TOKEN!,
      enableTelemetry: false,
      automaticDeserialization: true,
      retry: {
        retries: 2,
        backoff: (attempt) => Math.min(attempt * 50, 500),
      },
    })
  : null;

export const CACHE_TTL = {
  THEMES_LIST: 3600,
  THEME_DETAIL: 3600,
  COLOR_WAY: 3600,
  /** Live portfolio must always hit the DB — never serve stale Redis/CDN snapshots. */
  PUBLIC_PROFILE: 0,
  PUBLIC_SERVICES: 0,
  USER_SESSION: 30,
  USER_BIZCARDS: 60,
  COMPANY_EMPLOYEES: 60,
  COMPANY_ANALYTICS: 60,
  BIZCARD_DETAIL: 300,
  TEMPLATES_LIST: 3600,
  SUBSCRIPTION_PLANS: 3600,
  AFFILIATE_SUMMARY: 120,
  RATE_LIMIT: 60,
} as const;

export function generateCacheKey(...parts: Array<string | number | null | undefined>): string {
  return parts
    .filter((part) => part !== null && part !== undefined && String(part).trim().length > 0)
    .map((part) => String(part))
    .join(":");
}

export async function getCache<T>(key: string): Promise<T | null> {
  if (!key) return null;

  if (redis) {
    try {
      const cached = await redis.get<T>(key);
      return cached ?? null;
    } catch (error) {
      console.error("[cache] redis get failed", { key, error });
    }
  }

  const memory = memoryStore.get(key);
  if (!memory) return null;

  if (memory.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }

  return memory.value as T;
}

export async function setCache<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  if (!key) return;
  const ttl = Math.max(1, Math.floor(ttlSeconds));

  if (redis) {
    try {
      await redis.setex(key, ttl, value);
      return;
    } catch (error) {
      console.error("[cache] redis set failed", { key, error });
    }
  }

  memoryStore.set(key, {
    value,
    expiresAt: Date.now() + ttl * 1000,
  });
}

export async function getCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number = CACHE_TTL.PUBLIC_PROFILE
): Promise<{ data: T; cached: boolean }> {
  // ttl <= 0: bypass Redis/memory entirely (fresh reads for live portfolios).
  if (ttlSeconds <= 0) {
    const data = await fetcher();
    return { data, cached: false };
  }

  const cached = await getCache<T>(key);
  if (cached !== null) {
    return { data: cached, cached: true };
  }

  const data = await fetcher();
  if (data !== null && data !== undefined) {
    void setCache(key, data, ttlSeconds);
  }

  return { data, cached: false };
}

export async function invalidateCache(pattern: string): Promise<number> {
  if (!pattern) return 0;
  let removed = 0;

  if (redis) {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        removed += keys.length;
      }
    } catch (error) {
      console.error("[cache] redis invalidate failed", { pattern, error });
    }
  }

  const regex = new RegExp(`^${pattern.replace(/[.+^${}()|[\\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  for (const key of memoryStore.keys()) {
    if (regex.test(key)) {
      memoryStore.delete(key);
      removed += 1;
    }
  }

  return removed;
}

export async function invalidateCacheBatch(patterns: string[]): Promise<number> {
  const removed = await Promise.all(patterns.map((pattern) => invalidateCache(pattern)));
  return removed.reduce((sum, count) => sum + count, 0);
}

export const invalidateCachePattern = invalidateCache;
