import crypto from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { prismaAnalytics } from "@/server/lib/prisma-analytics";

const PORTFOLIO_OWNER_SELECT = {
  user_id: true,
  bizcard_id: true,
} as const;

export type PortfolioOwnerRef = {
  user_id: bigint;
  bizcard_id: bigint;
};

function toPortfolioOwnerRef(
  row: { user_id: bigint | null; bizcard_id: bigint } | null | undefined,
): PortfolioOwnerRef | null {
  if (!row?.user_id) return null;
  return { user_id: row.user_id, bizcard_id: row.bizcard_id };
}

/**
 * Resolve the portfolio owner using the same lookup strategy as public portfolio pages:
 * 1) bizcard.url_alias
 * 2) user.custom_uri (legacy / alternate public slug)
 * 3) bizcard.serial_id (6-character entry codes)
 */
export async function resolvePortfolioOwnerByPublicUri(
  rawUri: string,
): Promise<PortfolioOwnerRef | null> {
  const uri = rawUri.trim().replace(/^\/+/, "").toLowerCase();
  if (!uri || uri.length > 64) return null;

  const activeBizcardWhere = {
    deactivated_flag: false,
    user: { is: { is_active: true } },
  } as const;

  const byUrlAlias = await prisma.bizcard.findFirst({
    where: { url_alias: uri, ...activeBizcardWhere },
    select: PORTFOLIO_OWNER_SELECT,
  });
  const fromUrlAlias = toPortfolioOwnerRef(byUrlAlias);
  if (fromUrlAlias) return fromUrlAlias;

  const byCustomUri = await prisma.bizcard.findFirst({
    where: {
      deactivated_flag: false,
      user: { is: { custom_uri: uri, is_active: true } },
    },
    orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
    select: PORTFOLIO_OWNER_SELECT,
  });
  const fromCustomUri = toPortfolioOwnerRef(byCustomUri);
  if (fromCustomUri) return fromCustomUri;

  const serialCandidate = rawUri.trim().toUpperCase();
  if (/^[A-Z0-9]{6}$/.test(serialCandidate)) {
    const bySerial = await prisma.bizcard.findFirst({
      where: { serial_id: serialCandidate, ...activeBizcardWhere },
      select: PORTFOLIO_OWNER_SELECT,
    });
    const fromSerial = toPortfolioOwnerRef(bySerial);
    if (fromSerial) return fromSerial;
  }

  return null;
}

export function normalizePublicPortfolioUri(rawUri: string): string {
  return rawUri.trim().replace(/^\/+/, "").toLowerCase();
}

export function isTrackablePublicPortfolioUri(rawUri: string): boolean {
  const uri = normalizePublicPortfolioUri(rawUri);
  if (!uri || uri.length > 64) return false;
  if (/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/.test(uri) || /^[a-z0-9]{2,64}$/.test(uri)) {
    return true;
  }
  return /^[A-Z0-9]{6}$/.test(rawUri.trim().toUpperCase());
}

export const PORTFOLIO_VIEW_DEDUP_MS = 30 * 60 * 1000;
export const CONTACT_SAVE_DEDUP_MS = 24 * 60 * 60 * 1000;

export type PortfolioVisitorIdentity = {
  userId: number | null;
  sessionId: string | null;
  ipHash: string | null;
  ipPrefix: string | null;
};

export function hashVisitorIp(ip: string): string {
  const secret = process.env.IP_HASH_SECRET ?? "ontap-ip-hash-fallback";
  return crypto.createHmac("sha256", secret).update(ip).digest("hex");
}

export function isPortfolioOwnerSelfVisit(
  portfolioOwnerId: bigint,
  visitorUserId: number | null,
): boolean {
  return visitorUserId !== null && BigInt(visitorUserId) === portfolioOwnerId;
}

/** Returns true when this visitor already has a recorded view within the dedup window. */
export async function isDuplicatePortfolioView(
  portfolioOwnerId: bigint,
  visitor: PortfolioVisitorIdentity,
  windowMs: number = PORTFOLIO_VIEW_DEDUP_MS,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMs);
  const orConditions: Array<Record<string, unknown>> = [];

  if (visitor.userId) {
    orConditions.push({
      portfolio_owner_id: portfolioOwnerId,
      visitor_user_id: BigInt(visitor.userId),
      created_at: { gte: since },
    });
  }
  if (visitor.sessionId) {
    orConditions.push({
      portfolio_owner_id: portfolioOwnerId,
      anonymous_session_id: visitor.sessionId,
      created_at: { gte: since },
    });
  }
  if (visitor.ipHash) {
    orConditions.push({
      portfolio_owner_id: portfolioOwnerId,
      visitor_ip_hash: visitor.ipHash,
      created_at: { gte: since },
    });
  }

  if (orConditions.length === 0) return false;

  const hit = await prismaAnalytics.portfolioView.findFirst({
    where: { OR: orConditions },
    select: { id: true },
  });
  return Boolean(hit);
}

/** Returns true when this visitor already saved contact within the dedup window. */
export async function isDuplicateContactSave(
  portfolioOwnerId: bigint,
  visitor: PortfolioVisitorIdentity,
  windowMs: number = CONTACT_SAVE_DEDUP_MS,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMs);
  const orConditions: Array<Record<string, unknown>> = [];

  if (visitor.userId) {
    orConditions.push({
      portfolio_owner_id: portfolioOwnerId,
      visitor_user_id: BigInt(visitor.userId),
      created_at: { gte: since },
    });
  }
  if (visitor.sessionId) {
    orConditions.push({
      portfolio_owner_id: portfolioOwnerId,
      anonymous_session_id: visitor.sessionId,
      created_at: { gte: since },
    });
  }
  if (visitor.ipPrefix) {
    orConditions.push({
      portfolio_owner_id: portfolioOwnerId,
      visitor_ip_prefix: visitor.ipPrefix,
      created_at: { gte: since },
    });
  }

  if (orConditions.length === 0) return false;

  const hit = await prismaAnalytics.contactSave.findFirst({
    where: { OR: orConditions },
    select: { id: true },
  });
  return Boolean(hit);
}

export type AnalyticsFilter =
  | "today"
  | "yesterday"
  | "last_7_days"
  | "last_30_days"
  | "this_month"
  | "last_month"
  | "custom";

export interface AnalyticsDateRange {
  filter: AnalyticsFilter;
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function endOfUtcDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function toUtcDateOnly(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function resolveAnalyticsDateRange(
  filterRaw: string | null,
  startDateRaw: string | null,
  endDateRaw: string | null,
  now: Date = new Date()
): { ok: true; data: AnalyticsDateRange } | { ok: false; error: string } {
  const filter = (filterRaw ?? "last_30_days") as AnalyticsFilter;
  const todayStart = startOfUtcDay(now);
  const todayEnd = endOfUtcDay(now);

  let start: Date;
  let end: Date;

  switch (filter) {
    case "today": {
      start = todayStart;
      end = todayEnd;
      break;
    }
    case "yesterday": {
      const y = new Date(todayStart.getTime() - DAY_MS);
      start = startOfUtcDay(y);
      end = endOfUtcDay(y);
      break;
    }
    case "last_7_days": {
      start = startOfUtcDay(new Date(todayStart.getTime() - 6 * DAY_MS));
      end = todayEnd;
      break;
    }
    case "last_30_days": {
      start = startOfUtcDay(new Date(todayStart.getTime() - 29 * DAY_MS));
      end = todayEnd;
      break;
    }
    case "this_month": {
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
      end = todayEnd;
      break;
    }
    case "last_month": {
      const year = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
      const month = now.getUTCMonth() === 0 ? 11 : now.getUTCMonth() - 1;
      start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
      end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
      break;
    }
    case "custom": {
      if (!startDateRaw || !endDateRaw) {
        return { ok: false, error: "startDate and endDate are required when filter=custom." };
      }
      const parsedStart = toUtcDateOnly(startDateRaw);
      const parsedEnd = toUtcDateOnly(endDateRaw);
      if (!parsedStart || !parsedEnd) {
        return { ok: false, error: "startDate/endDate must be in YYYY-MM-DD format." };
      }
      start = startOfUtcDay(parsedStart);
      end = endOfUtcDay(parsedEnd);
      break;
    }
    default:
      return { ok: false, error: "Invalid filter value." };
  }

  if (start > end) {
    return { ok: false, error: "startDate must be before or equal to endDate." };
  }

  const rangeMs = end.getTime() - start.getTime() + 1;
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - rangeMs + 1);

  return {
    ok: true,
    data: {
      filter,
      start,
      end,
      previousStart,
      previousEnd,
    },
  };
}

export function formatPercentageChange(current: number, previous: number): string {
  if (previous === 0 && current === 0) return "0%";
  if (previous === 0 && current > 0) return "+100%";
  const pct = ((current - previous) / previous) * 100;
  const rounded = Math.round(pct * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}%`;
}

export function buildAnonymizedIpPrefix(ip: string): string | null {
  if (!ip || ip === "unknown") return null;

  // IPv4: keep first 3 octets, mask last
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }

  // IPv6: keep first 4 hextets, zero the rest
  if (ip.includes(":")) {
    const parts = ip.split(":");
    while (parts.length < 8) parts.push("0");
    return `${parts.slice(0, 4).join(":")}:0000:0000:0000:0000`;
  }

  return null;
}

export function extractGeoMetadata(request: NextRequest): {
  countryCode: string | null;
  country: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
} {
  const countryCode = request.headers.get("x-vercel-ip-country")?.trim() || null;
  const country = request.headers.get("x-vercel-ip-country-name")?.trim() || countryCode;
  const city = request.headers.get("x-vercel-ip-city")?.trim() || null;

  const latRaw = request.headers.get("x-vercel-ip-latitude");
  const lngRaw = request.headers.get("x-vercel-ip-longitude");
  const lat = latRaw ? Number(latRaw) : NaN;
  const lng = lngRaw ? Number(lngRaw) : NaN;

  return {
    countryCode,
    country,
    city,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
  };
}

export function formatTimeAgo(input: Date | string, now: Date = new Date()): string {
  const then = typeof input === "string" ? new Date(input) : input;
  const diffSec = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000));

  if (diffSec < 60) return `${diffSec} seconds ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} minutes ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} hours ago`;
  return `${Math.floor(diffSec / 86400)} days ago`;
}

export type AnalyticsCountRange = {
  gte?: Date;
  lte?: Date;
};

/** True when this is the owner's only active bizcard (legacy analytics rows have no bizcard_id). */
export async function isSoleActiveBizcardForOwner(
  ownerId: bigint,
  bizcardId: bigint,
): Promise<boolean> {
  const cards = await prisma.bizcard.findMany({
    where: { user_id: ownerId, deactivated_flag: false },
    select: { bizcard_id: true },
    take: 2,
  });
  return cards.length === 1 && cards[0]?.bizcard_id === bizcardId;
}

/**
 * Count portfolio views for a specific bizcard.
 * - Sole-card owners: all owner-scoped rows (includes legacy data without bizcard_id).
 * - Multi-card: rows tagged with this bizcard_id, plus untagged legacy rows only when none exist for other cards... we only include tagged + null attributed when sole.
 */
export async function countBizcardPortfolioViews(
  ownerId: bigint,
  bizcardId: bigint,
  range?: AnalyticsCountRange,
): Promise<number> {
  const createdAt =
    range?.gte || range?.lte
      ? {
          ...(range.gte ? { gte: range.gte } : {}),
          ...(range.lte ? { lte: range.lte } : {}),
        }
      : undefined;
  const sole = await isSoleActiveBizcardForOwner(ownerId, bizcardId);

  try {
    if (sole) {
      return await prismaAnalytics.portfolioView.count({
        where: {
          portfolio_owner_id: ownerId,
          ...(createdAt ? { created_at: createdAt } : {}),
        },
      });
    }
    return await prismaAnalytics.portfolioView.count({
      where: {
        portfolio_owner_id: ownerId,
        bizcard_id: bizcardId,
        ...(createdAt ? { created_at: createdAt } : {}),
      },
    });
  } catch (error) {
    // Fallback when analytics DB has not yet been migrated with bizcard_id.
    console.warn("[analytics] portfolioView count fallback to owner scope:", error);
    return prismaAnalytics.portfolioView.count({
      where: {
        portfolio_owner_id: ownerId,
        ...(createdAt ? { created_at: createdAt } : {}),
      },
    });
  }
}

export async function countBizcardContactSaves(
  ownerId: bigint,
  bizcardId: bigint,
  range?: AnalyticsCountRange,
): Promise<number> {
  const createdAt =
    range?.gte || range?.lte
      ? {
          ...(range.gte ? { gte: range.gte } : {}),
          ...(range.lte ? { lte: range.lte } : {}),
        }
      : undefined;
  const sole = await isSoleActiveBizcardForOwner(ownerId, bizcardId);

  try {
    if (sole) {
      return await prismaAnalytics.contactSave.count({
        where: {
          portfolio_owner_id: ownerId,
          ...(createdAt ? { created_at: createdAt } : {}),
        },
      });
    }
    return await prismaAnalytics.contactSave.count({
      where: {
        portfolio_owner_id: ownerId,
        bizcard_id: bizcardId,
        ...(createdAt ? { created_at: createdAt } : {}),
      },
    });
  } catch (error) {
    console.warn("[analytics] contactSave count fallback to owner scope:", error);
    return prismaAnalytics.contactSave.count({
      where: {
        portfolio_owner_id: ownerId,
        ...(createdAt ? { created_at: createdAt } : {}),
      },
    });
  }
}

/** Inquiry scope for a bizcard dashboard (status unread = new|unread). */
export function buildBizcardInquiryWhere(
  ownerId: bigint,
  bizcardId: bigint,
  sole: boolean,
): { user_id: bigint; bizcard_id?: bigint } {
  if (sole) return { user_id: ownerId };
  return { user_id: ownerId, bizcard_id: bizcardId };
}
