import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { prisma } from "@/server/lib/prisma";

type RateLimitRequest = {
  key: string;
  window: number;
  limit: number;
};

type RateLimitResult = {
  success: boolean;
  retryAfter?: number;
};

type Entry = {
  count: number;
  resetAt: number;
};

const store = new Map<string, Entry>();

export async function rateLimit(input: RateLimitRequest): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = Math.max(1, input.window) * 1000;
  const current = store.get(input.key);

  if (!current || current.resetAt <= now) {
    store.set(input.key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return { success: true };
  }

  if (current.count >= input.limit) {
    return {
      success: false,
      retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  store.set(input.key, current);
  return { success: true };
}

function resolveIp(request: NextRequest | Request): string {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const realIp = request.headers.get("x-real-ip") || "";
  const candidate = forwarded.split(",")[0]?.trim() || realIp.trim();
  return candidate || "anonymous";
}

function resolvePath(request: NextRequest | Request): string {
  if (request instanceof NextRequest) return request.nextUrl.pathname;

  try {
    return new URL(request.url).pathname;
  } catch {
    return "";
  }
}

export async function protectAgainstBots(request: NextRequest | Request) {
  const path = resolvePath(request);
  const ip = resolveIp(request);

  const isSensitivePath =
    path.includes("/api/bizcard/claim") ||
    path.includes("/api/bizcard/merge") ||
    path.includes("/api/cards/merge");

  if (!isSensitivePath) {
    return null;
  }

  const action = path.includes("/claim") ? "bizcard-claim" : "bizcard-merge-sensitive";
  const limited = checkRateLimit(action, ip);

  if (limited.allowed) {
    return null;
  }

  const retryAfter = Math.max(1, Math.ceil(limited.retryAfterMs / 1000));

  try {
    await prisma.securityAlert.create({
      data: {
        alert_type: "RATE_LIMIT_EXCEEDED",
        severity: "critical",
        ip_address: ip,
        user_agent: request.headers.get("user-agent") || null,
        metadata: JSON.stringify({
          action,
          path,
          retryAfter,
          triggeredAt: new Date().toISOString(),
        }),
      },
    });
  } catch {
    // Security logging is best-effort and should not block limiter response.
  }

  return NextResponse.json(
    {
      success: false,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests. Please wait before trying again.",
        retryAfter,
      },
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
      },
    }
  );
}
