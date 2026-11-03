import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp, getUserAgent, resolveRequestSession } from "@/server/lib/auth";
import {
  USER_ONLINE_CUTOFF_MINUTES,
} from "@/server/lib/user-presence";

export const CONNECTION_CACHE_TTL = {
  SUMMARY_MS: 30_000,
  LIST_MS: 60_000,
  FILTER_MS: 60 * 60_000,
  SUGGESTIONS_MS: 60 * 60_000,
  ONLINE_MS: 30_000,
} as const;

export const ONLINE_WINDOW_MINUTES = Number(
  process.env.ONLINE_STATUS_TIMEOUT_MINUTES ?? String(USER_ONLINE_CUTOFF_MINUTES),
);

type CacheEntry = { expiresAt: number; value: unknown };
const cacheStore = new Map<string, CacheEntry>();

export function getCached<T>(key: string): T | null {
  const now = Date.now();
  const hit = cacheStore.get(key);
  if (!hit) return null;
  if (now > hit.expiresAt) {
    cacheStore.delete(key);
    return null;
  }
  return hit.value as T;
}

export function setCached(key: string, value: unknown, ttlMs: number): void {
  cacheStore.set(key, { expiresAt: Date.now() + ttlMs, value });
}

export function clearConnectionCachePrefix(prefix: string): void {
  for (const key of cacheStore.keys()) {
    if (key.startsWith(prefix)) {
      cacheStore.delete(key);
    }
  }
}

export function anonymizeEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

export function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function parseBoolean(raw: string | null, fallback = false): boolean {
  if (raw === null) return fallback;
  if (raw === "1" || raw.toLowerCase() === "true") return true;
  if (raw === "0" || raw.toLowerCase() === "false") return false;
  return fallback;
}

export function parsePositiveInt(raw: string | null, fallback: number, max?: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  if (max && parsed > max) return max;
  return parsed;
}

export async function requireConnectionsSession(request: NextRequest) {
  const resolved = await resolveRequestSession(request);
  if (!resolved.session) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Authentication required.", requiresAuth: true }, { status: 401 }),
    };
  }
  return { ok: true as const, session: resolved.session, refreshed: resolved.refreshed };
}

export async function touchUserActivity(request: NextRequest, userId: bigint, sessionId?: bigint): Promise<void> {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);
  const now = new Date();

  const ipPrefix = (() => {
    if (!ip || ip === "unknown") return "unknown";
    if (ip.includes(".")) {
      const p = ip.split(".");
      return p.length >= 2 ? `${p[0]}.${p[1]}.x.x` : "unknown";
    }
    if (ip.includes(":")) {
      const p = ip.split(":").filter(Boolean);
      return p.length >= 2 ? `${p[0]}:${p[1]}:x:x` : "unknown";
    }
    return "unknown";
  })();

  await prisma.$transaction([
    prisma.userActivity.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        last_active: now,
        current_session_id: sessionId,
        ip_prefix: ipPrefix,
        user_agent: ua.substring(0, 512),
        updated_at: now,
      },
      update: {
        last_active: now,
        current_session_id: sessionId,
        ip_prefix: ipPrefix,
        user_agent: ua.substring(0, 512),
        updated_at: now,
      },
    }),
    prisma.user.update({
      where: { user_id: userId },
      data: {
        is_online: true,
        last_active: now,
      },
    }),
  ]);
}

export function nowMinusOnlineWindow(): Date {
  return new Date(Date.now() - ONLINE_WINDOW_MINUTES * 60_000);
}

export function formatAssociateCountLabel(count: number): string {
  if (count <= 0) return "0 Associates";
  if (count === 1) return "1 Associate";
  if (count < 100) return `${count} Associates`;
  if (count < 1000) return `${Math.floor(count / 100) * 100}+ Associates`;
  return `${Math.floor(count / 1000)}k+ Associates`;
}

export async function countAcceptedConnections(userId: bigint): Promise<number> {
  return prisma.connection.count({
    where: {
      status: "accepted",
      OR: [{ requester_user_id: userId }, { recipient_user_id: userId }],
    },
  });
}

export async function listMutualAssociates(
  viewerId: bigint,
  ownerId: bigint,
  limit = 12,
): Promise<Array<{
  id: string;
  name: string;
  profileUrl: string | null;
  portfolioUrl: string | null;
  position: string | null;
}>> {
  if (viewerId === ownerId) return [];
  const [viewerIds, ownerIds] = await Promise.all([
    getAcceptedConnectionUserIds(viewerId),
    getAcceptedConnectionUserIds(ownerId),
  ]);
  const ownerSet = new Set(ownerIds.map((id) => id.toString()));
  const mutualIds = viewerIds.filter((id) => ownerSet.has(id.toString())).slice(0, limit);
  if (mutualIds.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { user_id: { in: mutualIds }, is_active: true, deactivated_flag: false },
    select: {
      user_id: true,
      first_name: true,
      last_name: true,
      email: true,
      profile_url: true,
      job_position: true,
      custom_uri: true,
      bizcards: {
        where: { deactivated_flag: false, is_blank: false },
        orderBy: { updated_at: "desc" },
        take: 1,
        select: { url_alias: true, portfolio_url: true, profile_img: true },
      },
    },
  });

  return users.map((user) => {
    const card = user.bizcards[0];
    const alias = card?.url_alias || user.custom_uri;
    const name = `${user.first_name} ${user.last_name}`.trim() || user.email;
    return {
      id: user.user_id.toString(),
      name,
      profileUrl: card?.profile_img || user.profile_url,
      portfolioUrl: card?.portfolio_url || (alias ? `/${encodeURIComponent(alias)}` : null),
      position: user.job_position,
    };
  });
}

export async function getAcceptedConnectionUserIds(userId: bigint): Promise<bigint[]> {
  const edges = await prisma.connection.findMany({
    where: {
      status: "accepted",
      OR: [{ requester_user_id: userId }, { recipient_user_id: userId }],
    },
    select: {
      requester_user_id: true,
      recipient_user_id: true,
    },
  });

  const ids: bigint[] = [];
  for (const edge of edges) {
    const other = edge.requester_user_id === userId ? edge.recipient_user_id : edge.requester_user_id;
    ids.push(other);
  }
  return ids;
}

export async function getMutualConnectionCounts(userId: bigint, friendIds: bigint[]): Promise<Map<string, number>> {
  if (friendIds.length === 0) {
    return new Map();
  }

  const mutualEdges = await prisma.connection.findMany({
    where: {
      status: "accepted",
      OR: [
        {
          requester_user_id: { in: friendIds },
          recipient_user_id: { in: friendIds },
        },
        {
          recipient_user_id: { in: friendIds },
          requester_user_id: { in: friendIds },
        },
      ],
    },
    select: {
      requester_user_id: true,
      recipient_user_id: true,
    },
  });

  const counts = new Map<string, number>();
  for (const edge of mutualEdges) {
    const requesterKey = edge.requester_user_id.toString();
    const recipientKey = edge.recipient_user_id.toString();
    counts.set(requesterKey, (counts.get(requesterKey) ?? 0) + 1);
    counts.set(recipientKey, (counts.get(recipientKey) ?? 0) + 1);
  }
  return counts;
}

export async function isBlockedEitherDirection(a: bigint, b: bigint): Promise<boolean> {
  const existing = await prisma.blockedUser.findFirst({
    where: {
      OR: [
        { user_id: a, blocked_user_id: b },
        { user_id: b, blocked_user_id: a },
      ],
    },
    select: { id: true },
  });
  return Boolean(existing);
}

export function asCursor(raw: string | null): bigint | null {
  if (!raw || !/^\d{1,20}$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}
