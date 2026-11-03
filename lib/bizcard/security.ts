// lib/bizcard/security.ts
import { NextRequest } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

// Store for serial ID search attempts
const serialSearchAttempts = new Map<string, { count: number; firstAttempt: number; blockedUntil: number }>();

const SERIAL_SEARCH_CONFIG = {
  WINDOW_MS: 60 * 1000,      // 1 minute window
  MAX_ATTEMPTS: 10,          // 10 attempts per window
  BLOCK_DURATION_MS: 5 * 60 * 1000, // 5 minute block
};

export function checkSerialSearchRateLimit(ip: string): RateLimitResult {
  const now = Date.now();
  const record = serialSearchAttempts.get(ip);
  
  if (record) {
    // Check if currently blocked
    if (record.blockedUntil > now) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: record.blockedUntil - now,
      };
    }
    
    // Reset window if expired
    if (now - record.firstAttempt > SERIAL_SEARCH_CONFIG.WINDOW_MS) {
      const newRecord = {
        count: 1,
        firstAttempt: now,
        blockedUntil: 0,
      };
      serialSearchAttempts.set(ip, newRecord);
      return { allowed: true, remaining: SERIAL_SEARCH_CONFIG.MAX_ATTEMPTS - 1, retryAfterMs: 0 };
    }
    
    // Check if exceeded limit
    if (record.count >= SERIAL_SEARCH_CONFIG.MAX_ATTEMPTS) {
      const blockedUntil = now + SERIAL_SEARCH_CONFIG.BLOCK_DURATION_MS;
      serialSearchAttempts.set(ip, { ...record, blockedUntil });
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: SERIAL_SEARCH_CONFIG.BLOCK_DURATION_MS,
      };
    }
    
    // Increment count
    record.count++;
    serialSearchAttempts.set(ip, record);
    return {
      allowed: true,
      remaining: SERIAL_SEARCH_CONFIG.MAX_ATTEMPTS - record.count,
      retryAfterMs: 0,
    };
  }
  
  // First attempt
  serialSearchAttempts.set(ip, {
    count: 1,
    firstAttempt: now,
    blockedUntil: 0,
  });
  
  return {
    allowed: true,
    remaining: SERIAL_SEARCH_CONFIG.MAX_ATTEMPTS - 1,
    retryAfterMs: 0,
  };
}

export function clearSerialSearchAttempts(ip: string): void {
  serialSearchAttempts.delete(ip);
}

// Superadmin rate limits
export const SUPERADMIN_BIZCARD_RATE_LIMITS = {
  GENERATE: { limit: 20, window: 60, action: "superadmin-bizcard-generate" },
  DOWNLOAD: { limit: 20, window: 60, action: "superadmin-bizcard-download" },
  DETAIL: { limit: 120, window: 60, action: "superadmin-bizcard-detail" },
  // Dedicated bucket so Available-card deletes are not starved by DETAIL hydration.
  DELETE: { limit: 300, window: 60, action: "superadmin-bizcard-delete" },
  CLAIM: { limit: 10, window: 10, action: "bizcard-claim" },
  MERGE: { limit: 10, window: 10, action: "bizcard-merge-sensitive" },
  RESOLVE: { limit: 60, window: 60, action: "bizcard-resolve" },
  MARK_DISTRIBUTED: { limit: 30, window: 60, action: "superadmin-bizcard-mark-distributed" },
  MARK_DISTRIBUTED_ALL: { limit: 5, window: 60, action: "superadmin-bizcard-mark-distributed-all" },
} as const;

export function checkSuperadminRateLimit(
  req: NextRequest,
  endpoint: keyof typeof SUPERADMIN_BIZCARD_RATE_LIMITS
): { allowed: boolean; retryAfter?: number } {
  const config = SUPERADMIN_BIZCARD_RATE_LIMITS[endpoint];
  const ip = getClientIp(req);
  const result = checkRateLimit(config.action, ip);
  
  if (!result.allowed) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil(result.retryAfterMs / 1000)),
    };
  }
  
  return { allowed: true };
}