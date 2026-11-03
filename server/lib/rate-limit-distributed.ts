type Tier = "public" | "authenticated" | "sensitive" | "login" | "checkout" | "health";

interface TierConfig {
  limit: number;
  windowSeconds: number;
}

interface DistributedRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
  fallback: boolean;
}

const TIER_CONFIG: Record<Tier, TierConfig> = {
  public: { limit: 60, windowSeconds: 60 },
  authenticated: { limit: 300, windowSeconds: 60 },
  sensitive: { limit: 10, windowSeconds: 60 },
  login: { limit: 5, windowSeconds: 300 },
  checkout: { limit: 3, windowSeconds: 3600 },
  health: { limit: 10, windowSeconds: 60 },
};

const fallbackStore = new Map<string, { count: number; resetAt: number }>();

function getUpstashConfig(): { url: string; token: string } | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ??
    process.env.UPSTASH_REDIS_URL ??
    "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.UPSTASH_REDIS_TOKEN ?? "";

  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

async function upstashCommand(url: string, token: string, args: Array<string | number>): Promise<unknown> {
  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([args]),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Upstash request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as Array<{ result?: unknown; error?: string }>;
  if (!Array.isArray(payload) || payload.length === 0 || payload[0].error) {
    throw new Error(payload?.[0]?.error ?? "Invalid Upstash response");
  }

  return payload[0].result;
}

function checkFallbackRateLimit(key: string, config: TierConfig): DistributedRateLimitResult {
  const now = Date.now();
  const entry = fallbackStore.get(key);

  if (!entry || now > entry.resetAt) {
    fallbackStore.set(key, {
      count: 1,
      resetAt: now + config.windowSeconds * 1000,
    });
    return {
      allowed: true,
      limit: config.limit,
      remaining: config.limit - 1,
      retryAfterMs: 0,
      fallback: true,
    };
  }

  if (entry.count >= config.limit) {
    return {
      allowed: false,
      limit: config.limit,
      remaining: 0,
      retryAfterMs: Math.max(0, entry.resetAt - now),
      fallback: true,
    };
  }

  entry.count += 1;
  fallbackStore.set(key, entry);

  return {
    allowed: true,
    limit: config.limit,
    remaining: config.limit - entry.count,
    retryAfterMs: 0,
    fallback: true,
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of fallbackStore) {
    if (now > entry.resetAt) {
      fallbackStore.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

export async function checkDistributedRateLimit(identifier: string, tier: Tier): Promise<DistributedRateLimitResult> {
  const config = TIER_CONFIG[tier];
  const now = Date.now();
  const resetAt = now + config.windowSeconds * 1000;
  const key = `rl:${tier}:${identifier}`;

  const upstash = getUpstashConfig();
  if (!upstash) {
    return checkFallbackRateLimit(key, config);
  }

  try {
    const count = Number(await upstashCommand(upstash.url, upstash.token, ["INCR", key]));
    if (count === 1) {
      await upstashCommand(upstash.url, upstash.token, ["EXPIRE", key, config.windowSeconds]);
    }

    if (count > config.limit) {
      return {
        allowed: false,
        limit: config.limit,
        remaining: 0,
        retryAfterMs: resetAt - now,
        fallback: false,
      };
    }

    return {
      allowed: true,
      limit: config.limit,
      remaining: config.limit - count,
      retryAfterMs: 0,
      fallback: false,
    };
  } catch (error) {
    console.error("Distributed rate limit failed, using fallback:", error);

    if (tier === "login" || tier === "checkout") {
      return {
        allowed: false,
        limit: config.limit,
        remaining: 0,
        retryAfterMs: config.windowSeconds * 1000,
        fallback: false,
      };
    }

    return checkFallbackRateLimit(key, config);
  }
}
