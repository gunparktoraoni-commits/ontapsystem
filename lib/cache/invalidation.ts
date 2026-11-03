import { generateCacheKey, invalidateCache, invalidateCacheBatch } from "@/lib/cache";

function toId(value: string | number | bigint): string {
  return typeof value === "string" ? value : value.toString();
}

export async function invalidateUserCache(userId: string | number | bigint): Promise<number> {
  const id = toId(userId);
  const patterns = [
    generateCacheKey("user", id, "*"),
    generateCacheKey("user", id, "bizcards", "*"),
    generateCacheKey("affiliate", id, "*"),
    generateCacheKey("notifications", id, "*"),
  ];

  return invalidateCacheBatch(patterns);
}

export async function invalidateUsersCache(userIds: Array<string | number | bigint>): Promise<number> {
  const results = await Promise.all(userIds.map((userId) => invalidateUserCache(userId)));
  return results.reduce((sum, count) => sum + count, 0);
}

export async function invalidateBizcardCache(bizcardId: string | number | bigint): Promise<number> {
  const id = toId(bizcardId);
  const patterns = [
    generateCacheKey("bizcard", id, "*"),
    generateCacheKey("public", "profile", "*"),
    generateCacheKey("public", "gallery", "*"),
    generateCacheKey("user", "*", "bizcards", "*"),
  ];

  return invalidateCacheBatch(patterns);
}

export async function invalidateCachePattern(pattern: string): Promise<number> {
  return invalidateCache(pattern);
}
