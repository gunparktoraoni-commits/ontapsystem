// lib/services/client-management.service.ts
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { AppError } from "@/lib/errors/types";
import { ClientErrorCode, createClientError } from "@/lib/errors/client-errors";
import {
  normalizeClientAltEmail,
  normalizeClientPhone,
  resolveClientExportDateRange,
  type ClientDateFilter,
} from "@/lib/utils/client-management";
import { prisma } from "@/server/lib/prisma";
import { toJsonString } from "@/server/lib/json-field";
import {
  getOnlineCutoffDate,
  isUserCurrentlyOnline,
  USER_ONLINE_CUTOFF_MINUTES,
} from "@/server/lib/user-presence";

export type { ClientDateFilter };

type ClientStatus = "active" | "restricted" | "inactive";
type SubscriptionTier = "free" | "basic" | "premium" | "enterprise";

export interface ClientListFilters { page: number; limit: number; search?: string; status?: "active" | "restricted" | "all"; subscription_type?: string; sort_by?: "created_at" | "last_active" | "name" | "email"; sort_dir?: "asc" | "desc"; }
export interface ClientExportFilters { search?: string; filter?: string; client_name?: string; status?: "active" | "restricted" | "all"; subscription_type?: string; date_filter?: ClientDateFilter; start_date?: string; end_date?: string; }
export interface ClientSummaryPeriodStat {
  count: number;
  previous: number;
  percentage_change: number;
}

export interface ClientSummary {
  total_clients: number;
  total_subscribers: number;
  total_active: number;
  total_online: number;
  total_subscriptions: { free: number; basic: number; premium: number; enterprise: number };
  subscription_breakdown: { basic: number; standard: number; premium: number };
  top_locations: Array<{ label: string; count: number }>;
  newly_added: number;
  new_clients: number;
  newly_added_period_days: number;
  new_users: {
    today: ClientSummaryPeriodStat;
    week: ClientSummaryPeriodStat;
    month: ClientSummaryPeriodStat;
  };
}
export interface OnlineClient { user_id: number; name: string; email: string; subscription_type: string; last_active: Date; status: ClientStatus; created_at: Date; profile_image?: string; }
export interface ClientListItem extends OnlineClient { is_online: boolean; restriction_reason: string | null; restricted_until: Date | null; bizcard_count: number; joined_at: Date; }
export interface ClientPagination { page: number; limit: number; total: number; pages: number; has_next: boolean; has_previous: boolean; }
export interface ClientDetail { user_id: number; first_name: string; last_name: string; email: string; alt_email: string | null; phone: string | null; alt_phone: string | null; profile_img: string | null; cover_photo: string | null; subscription_tier: string; subscription_expiry: Date | null; is_active: boolean; is_restricted: boolean; restriction_reason: string | null; restricted_until: Date | null; restricted_by: number | null; restricted_at: Date | null; created_at: Date; last_active: Date | null; is_online: boolean; company: { company_id: number; company_name: string; subscription_tier: string | null; } | null; bizcards: Array<{ bizcard_id: number; bizcard_name: string; url_alias: string | null; created_at: Date; }>; }
export type ExportFormat = "csv" | "xlsx";

const ONLINE_CUTOFF_MINUTES = USER_ONLINE_CUTOFF_MINUTES;
// Raised from 100 to 10000 so the Super Admin Users feature can retrieve the
// full client dataset in a single request, enabling search across all records.
const CLIENT_LIST_MAX_LIMIT = 10000;
const MAX_EXPORT_ROWS = 25000;

const CLIENT_LIST_SELECT = {
  user_id: true,
  first_name: true,
  last_name: true,
  email: true,
  last_active: true,
  is_online: true,
  is_restricted: true,
  restriction_reason: true,
  restricted_until: true,
  is_active: true,
  created_at: true,
  profile_url: true,
  userActivity: { select: { last_active: true } },
} satisfies Prisma.UserSelect;

type ClientListRow = Prisma.UserGetPayload<{ select: typeof CLIENT_LIST_SELECT }>;

function normalizeSearch(search: string | undefined): string | undefined {
  const value = search?.trim();
  return value ? value : undefined;
}

function normalizeTierValue(value: string): SubscriptionTier | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "free" || normalized === "basic" || normalized === "premium" || normalized === "enterprise") return normalized;
  return null;
}

function normalizeSubscriptionFilter(value: string | undefined): SubscriptionTier | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "all") return undefined;
  const tier = normalizeTierValue(normalized);
  return tier ?? undefined;
}

function planNameCandidates(tier: SubscriptionTier): string[] {
  const upper = tier.toUpperCase();
  const title = tier.charAt(0).toUpperCase() + tier.slice(1);
  return [tier, upper, title];
}

async function getUserSubscriptionInfo(userId: bigint): Promise<{ tier: SubscriptionTier; expiry: Date | null }> {
  const subscription = await prisma.bizcardSubscription.findFirst({
    where: {
      bizcard: { user_id: userId, deactivated_flag: false },
      status: "active",
    },
    select: {
      plan: { select: { name: true } },
      expires_at: true,
    },
    orderBy: { expires_at: "desc" },
  });
  if (!subscription) return { tier: "free", expiry: null };
  const planName = subscription.plan?.name?.toLowerCase() || "free";
  const tier = normalizeTierValue(planName) ?? "free";
  return { tier, expiry: subscription.expires_at };
}

function isEffectivelyRestricted(isRestricted: boolean, restrictedUntil: Date | null): boolean {
  if (!isRestricted) return false;
  return restrictedUntil === null || restrictedUntil.getTime() > Date.now();
}

function resolveStatus(isActive: boolean, isRestricted: boolean, restrictedUntil: Date | null): ClientStatus {
  if (isEffectivelyRestricted(isRestricted, restrictedUntil)) return "restricted";
  return isActive ? "active" : "inactive";
}

function escapeCsv(value: unknown): string {
  const stringValue = value == null ? "" : String(value);
  if (stringValue.includes(",") || stringValue.includes("\"") || stringValue.includes("\n")) {
    return `"${stringValue.replace(/\"/g, '""')}"`;
  }
  return stringValue;
}

function toOrderBy(
  sortBy: ClientListFilters["sort_by"],
  sortDir: ClientListFilters["sort_dir"]
): Prisma.UserOrderByWithRelationInput | Prisma.UserOrderByWithRelationInput[] {
  const direction = sortDir ?? "desc";
  if (sortBy === "name") return [{ first_name: direction }, { last_name: direction }];
  if (sortBy === "email") return { email: direction };
  if (sortBy === "last_active") return { last_active: direction };
  return { created_at: direction };
}

function toClientListItem(
  row: ClientListRow,
  onlineCutoff: Date,
  subscriptionTier: SubscriptionTier,
  bizcardCount: number,
): ClientListItem {
  const derivedLastActive = row.last_active ?? row.userActivity?.last_active ?? row.created_at;
  const isOnline = isUserCurrentlyOnline({
    is_online: row.is_online,
    last_active: derivedLastActive,
  });
  return {
    user_id: Number(row.user_id),
    name: `${row.first_name} ${row.last_name}`.trim(),
    email: row.email,
    subscription_type: subscriptionTier,
    last_active: derivedLastActive,
    status: resolveStatus(row.is_active, row.is_restricted, row.restricted_until),
    created_at: row.created_at,
    joined_at: row.created_at,
    profile_image: row.profile_url ?? undefined,
    is_online: isOnline,
    restriction_reason: row.restriction_reason,
    restricted_until: row.restricted_until,
    bizcard_count: bizcardCount,
  };
}

export class ClientManagementService {
  private readonly requestId: string;
  constructor(requestId: string) { this.requestId = requestId; }

  async verifySuperAdmin(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { user_id: BigInt(userId) },
      select: { role: true },
    });
    if (!user || user.role !== "super_admin") {
      throw createClientError(ClientErrorCode.SUPERADMIN_REQUIRED, "SuperAdmin access required", 403, this.requestId, { userId });
    }
  }

  async getClientSummary(): Promise<ClientSummary> {
    const now = new Date();
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const startOfDay = (d: Date) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const startOfWeek = (d: Date) => {
      const day = d.getDay(); // 0 = Sunday
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const start = startOfDay(d);
      start.setDate(start.getDate() + mondayOffset);
      return start;
    };
    const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);

    const todayStart = startOfDay(now);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const weekStart = startOfWeek(now);
    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const monthStart = startOfMonth(now);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);

    const pctChange = (current: number, previous: number): number => {
      if (previous === 0) return current === 0 ? 0 : 100;
      return Math.round(((current - previous) / previous) * 1000) / 10;
    };

    const mapMarketingTier = (planName: string): "basic" | "standard" | "premium" => {
      const n = planName.trim().toLowerCase();
      if (n.includes("premium") || n.includes("enterprise")) return "premium";
      if (
        n.includes("standard") ||
        n.includes("trial") ||
        n === "free" ||
        n.includes("free_trial")
      ) {
        return "standard";
      }
      if (n.includes("basic")) return "basic";
      return "basic";
    };

    const activeSubs = await prisma.bizcardSubscription.findMany({
      where: { status: "active", expires_at: { gt: now } },
      select: {
        plan: { select: { name: true, tier_code: true } },
        bizcard: { select: { user_id: true } },
        expires_at: true,
      },
    });

    const userIdsWithSub = new Set<bigint>();
    for (const sub of activeSubs) {
      const uid = sub.bizcard?.user_id;
      if (uid != null) userIdsWithSub.add(uid);
    }
    const totalSubscribers = userIdsWithSub.size;

    const userTierMap = new Map<bigint, SubscriptionTier>();
    const marketingTierMap = new Map<bigint, "basic" | "standard" | "premium">();
    for (const sub of activeSubs) {
      const uid = sub.bizcard?.user_id;
      if (uid == null) continue;
      const planLabel = (sub.plan?.tier_code || sub.plan?.name || "free").toLowerCase();
      const tier = normalizeTierValue(planLabel) || "free";
      const existing = userTierMap.get(uid);
      if (!existing || tier === "premium" || tier === "enterprise") {
        userTierMap.set(uid, tier);
      }
      const marketing = mapMarketingTier(planLabel);
      const existingMarketing = marketingTierMap.get(uid);
      const rank = { basic: 1, standard: 2, premium: 3 } as const;
      if (!existingMarketing || rank[marketing] >= rank[existingMarketing]) {
        marketingTierMap.set(uid, marketing);
      }
    }

    const tierCounts = { free: 0, basic: 0, premium: 0, enterprise: 0 };
    for (const tier of userTierMap.values()) {
      if (tier === "basic") tierCounts.basic++;
      else if (tier === "premium") tierCounts.premium++;
      else if (tier === "enterprise") tierCounts.enterprise++;
      else tierCounts.free++;
    }

    const subscriptionBreakdown = { basic: 0, standard: 0, premium: 0 };
    for (const tier of marketingTierMap.values()) {
      subscriptionBreakdown[tier]++;
    }

    const onlineCutoff = getOnlineCutoffDate(now);
    const userRoleWhere = { role: "user" as const, deleted_at: null };

    const [
      totalClients,
      totalActive,
      totalOnline,
      newlyAdded,
      newToday,
      newYesterday,
      newThisWeek,
      newLastWeek,
      newThisMonth,
      newLastMonth,
      locationRows,
    ] = await Promise.all([
      prisma.user.count({ where: userRoleWhere }),
      prisma.user.count({
        where: {
          ...userRoleWhere,
          is_active: true,
          OR: [{ is_restricted: false }, { restricted_until: { lt: now } }],
        },
      }),
      // Fresh last_active only — matches isUserCurrentlyOnline
      prisma.user.count({
        where: {
          ...userRoleWhere,
          last_active: { gte: onlineCutoff },
        },
      }),
      prisma.user.count({ where: { ...userRoleWhere, created_at: { gte: since } } }),
      prisma.user.count({ where: { ...userRoleWhere, created_at: { gte: todayStart, lte: now } } }),
      prisma.user.count({
        where: { ...userRoleWhere, created_at: { gte: yesterdayStart, lt: todayStart } },
      }),
      prisma.user.count({ where: { ...userRoleWhere, created_at: { gte: weekStart, lte: now } } }),
      prisma.user.count({
        where: { ...userRoleWhere, created_at: { gte: lastWeekStart, lt: weekStart } },
      }),
      prisma.user.count({ where: { ...userRoleWhere, created_at: { gte: monthStart, lte: now } } }),
      prisma.user.count({
        where: { ...userRoleWhere, created_at: { gte: lastMonthStart, lt: monthStart } },
      }),
      prisma.user.findMany({
        where: {
          ...userRoleWhere,
          OR: [
            { registration_city: { not: null } },
            { registration_country: { not: null } },
            { registration_location: { not: null } },
            { last_login_city: { not: null } },
            { last_login_country: { not: null } },
          ],
        },
        select: {
          registration_city: true,
          registration_country: true,
          registration_location: true,
          last_login_city: true,
          last_login_country: true,
        },
        take: 5000,
      }),
    ]);

    const locationCounts = new Map<string, number>();
    for (const row of locationRows) {
      const label =
        [row.registration_city, row.registration_country].filter(Boolean).join(", ") ||
        row.registration_location?.trim() ||
        [row.last_login_city, row.last_login_country].filter(Boolean).join(", ") ||
        "";
      if (!label) continue;
      locationCounts.set(label, (locationCounts.get(label) ?? 0) + 1);
    }
    const topLocations = [...locationCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, count]) => ({ label, count }));

    return {
      total_clients: totalClients,
      total_subscribers: totalSubscribers,
      total_active: totalActive,
      total_online: totalOnline,
      total_subscriptions: tierCounts,
      subscription_breakdown: subscriptionBreakdown,
      top_locations: topLocations,
      newly_added: newlyAdded,
      new_clients: newlyAdded,
      newly_added_period_days: 30,
      new_users: {
        today: {
          count: newToday,
          previous: newYesterday,
          percentage_change: pctChange(newToday, newYesterday),
        },
        week: {
          count: newThisWeek,
          previous: newLastWeek,
          percentage_change: pctChange(newThisWeek, newLastWeek),
        },
        month: {
          count: newThisMonth,
          previous: newLastMonth,
          percentage_change: pctChange(newThisMonth, newLastMonth),
        },
      },
    };
  }

  async getClients(filters: ClientListFilters): Promise<{ clients: ClientListItem[]; pagination: ClientPagination }> {
    // Clamp to CLIENT_LIST_MAX_LIMIT instead of rejecting, so callers requesting
    // the full dataset (limit=10000) are always served correctly.
    if (filters.limit > CLIENT_LIST_MAX_LIMIT) {
      filters = { ...filters, limit: CLIENT_LIST_MAX_LIMIT };
    }
    const page = Math.max(1, filters.page);
    const limit = Math.max(1, filters.limit);
    const skip = (page - 1) * limit;
    const now = new Date();
    const onlineCutoff = new Date(now.getTime() - ONLINE_CUTOFF_MINUTES * 60 * 1000);
    const status = filters.status ?? "all";
    const search = normalizeSearch(filters.search);
    const subscriptionTier = normalizeSubscriptionFilter(filters.subscription_type);

    const userWhere: Prisma.UserWhereInput = { role: "user", deleted_at: null };
    if (status === "active") {
      userWhere.is_active = true;
      userWhere.OR = [{ is_restricted: false }, { restricted_until: { lt: now } }];
    } else if (status === "restricted") {
      userWhere.is_restricted = true;
      userWhere.OR = [{ restricted_until: null }, { restricted_until: { gt: now } }];
    }
    if (search) {
      userWhere.OR = [
        { first_name: { contains: search } },
        { last_name: { contains: search } },
        { email: { contains: search } },
      ];
    }

    if (subscriptionTier) {
      const subs = await prisma.bizcardSubscription.findMany({
        where: {
          status: "active",
          expires_at: { gt: now },
          plan: { name: { in: planNameCandidates(subscriptionTier) } },
        },
        select: { bizcard: { select: { user_id: true } } },
        distinct: ["bizcard_id"],
      });
      const userIdsWithTier = subs
        .map(s => s.bizcard?.user_id)
        .filter((id): id is bigint => id !== null);
      if (userIdsWithTier.length === 0) {
        return { clients: [], pagination: { page, limit, total: 0, pages: 0, has_next: false, has_previous: false } };
      }
      userWhere.user_id = { in: userIdsWithTier };
    }

    const [total, rows] = await Promise.all([
      prisma.user.count({ where: userWhere }),
      prisma.user.findMany({
        where: userWhere,
        select: CLIENT_LIST_SELECT,
        orderBy: toOrderBy(filters.sort_by, filters.sort_dir),
        skip,
        take: limit,
      }),
    ]);

    const userIds = rows.map(r => r.user_id);
    const subTiers = new Map<bigint, SubscriptionTier>();
    const bizcardCountMap = new Map<bigint, number>();
    if (userIds.length > 0) {
      const [subs, bizcardCounts] = await Promise.all([
        prisma.bizcardSubscription.findMany({
          where: {
            bizcard: { user_id: { in: userIds }, deactivated_flag: false },
            status: "active",
          },
          select: {
            plan: { select: { name: true } },
            bizcard: { select: { user_id: true } },
          },
        }),
        prisma.bizcard.groupBy({
          by: ["user_id"],
          where: { user_id: { in: userIds }, deactivated_flag: false },
          _count: { bizcard_id: true },
        }),
      ]);
      for (const sub of subs) {
        const uid = sub.bizcard?.user_id;
        if (uid === null) continue;
        const tier = normalizeTierValue(sub.plan?.name?.toLowerCase() || "free") || "free";
        const existing = subTiers.get(uid);
        if (!existing || tier === "premium" || tier === "enterprise") {
          subTiers.set(uid, tier);
        }
      }
      for (const row of bizcardCounts) {
        if (row.user_id != null) {
          bizcardCountMap.set(row.user_id, row._count.bizcard_id);
        }
      }
    }

    const clients = rows.map(row => {
      const tier = subTiers.get(row.user_id) || "free";
      const bizcardCount = bizcardCountMap.get(row.user_id) ?? 0;
      return toClientListItem(row, onlineCutoff, tier, bizcardCount);
    });

    const pages = Math.ceil(total / limit);
    return {
      clients,
      pagination: { page, limit, total, pages, has_next: page < pages, has_previous: page > 1 },
    };
  }

  // === ADDED getOnlineClients ===
  async getOnlineClients(filters: ClientListFilters): Promise<{ clients: OnlineClient[]; pagination: ClientPagination }> {
    const page = Math.max(1, filters.page);
    const limit = Math.min(filters.limit || 15, 50);
    const skip = (page - 1) * limit;
    const now = new Date();
    const onlineCutoff = new Date(now.getTime() - ONLINE_CUTOFF_MINUTES * 60 * 1000);

    const where: Prisma.UserWhereInput = {
      role: "user",
      OR: [
        { last_active: { gte: onlineCutoff } },
        { is_online: true },
      ],
    };

    if (filters.search) {
      where.OR = [
        { first_name: { contains: filters.search } },
        { last_name: { contains: filters.search } },
        { email: { contains: filters.search } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: CLIENT_LIST_SELECT,
        orderBy: toOrderBy(filters.sort_by || "last_active", filters.sort_dir || "desc"),
        skip,
        take: limit,
      }),
    ]);

    const userIds = rows.map(r => r.user_id);
    const subTiers = new Map<bigint, SubscriptionTier>();
    if (userIds.length > 0) {
      const subs = await prisma.bizcardSubscription.findMany({
        where: {
          bizcard: { user_id: { in: userIds }, deactivated_flag: false },
          status: "active",
        },
        select: {
          plan: { select: { name: true } },
          bizcard: { select: { user_id: true } },
        },
      });
      for (const sub of subs) {
        const uid = sub.bizcard?.user_id;
        if (uid === null) continue;
        const tier = normalizeTierValue(sub.plan?.name?.toLowerCase() || "free") || "free";
        const existing = subTiers.get(uid);
        if (!existing || tier === "premium" || tier === "enterprise") {
          subTiers.set(uid, tier);
        }
      }
    }

    const clients: OnlineClient[] = rows.map(row => {
      const tier = subTiers.get(row.user_id) || "free";
      const derivedLastActive = row.last_active ?? row.userActivity?.last_active ?? row.created_at;
      const isOnline = isUserCurrentlyOnline({
        is_online: row.is_online,
        last_active: derivedLastActive,
      });
      return {
        user_id: Number(row.user_id),
        name: `${row.first_name} ${row.last_name}`.trim(),
        email: row.email,
        subscription_type: tier,
        last_active: derivedLastActive,
        status: resolveStatus(row.is_active, row.is_restricted, row.restricted_until),
        created_at: row.created_at,
        profile_image: row.profile_url ?? undefined,
        is_online: isOnline,
        restriction_reason: row.restriction_reason,
        restricted_until: row.restricted_until,
      };
    });

    const pages = Math.ceil(total / limit);
    return {
      clients,
      pagination: { page, limit, total, pages, has_next: page < pages, has_previous: page > 1 },
    };
  }

  async getClientById(clientId: number): Promise<ClientDetail> {
    const user = await prisma.user.findFirst({
      where: { user_id: BigInt(clientId), role: "user" },
      select: {
        user_id: true, first_name: true, last_name: true, email: true, contact: true, alt_contact: true,
        alt_email: true, profile_url: true, cover_url: true, is_active: true, is_restricted: true,
        restriction_reason: true, restricted_until: true, restricted_by: true, restricted_at: true,
        is_online: true, last_active: true, created_at: true,
        company: { select: { company_id: true, name: true, subscription_tier: true } },
        bizcards: {
          where: { deactivated_flag: false },
          orderBy: { created_at: "desc" },
          take: 5,
          select: { bizcard_id: true, bizcard_name: true, url_alias: true, created_at: true },
        },
      },
    });
    if (!user) throw createClientError(ClientErrorCode.CLIENT_NOT_FOUND, `Client ${clientId} not found`, 404, this.requestId);

    const onlineCutoff = getOnlineCutoffDate();
    const isOnline = isUserCurrentlyOnline({
      is_online: user.is_online,
      last_active: user.last_active,
    });

    const { tier, expiry } = await getUserSubscriptionInfo(user.user_id);

    return {
      user_id: Number(user.user_id),
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      alt_email: user.alt_email,
      phone: user.contact,
      alt_phone: user.alt_contact,
      profile_img: user.profile_url,
      cover_photo: user.cover_url,
      subscription_tier: tier,
      subscription_expiry: expiry,
      is_active: user.is_active,
      is_restricted: isEffectivelyRestricted(user.is_restricted, user.restricted_until),
      restriction_reason: user.restriction_reason,
      restricted_until: user.restricted_until,
      restricted_by: user.restricted_by ? Number(user.restricted_by) : null,
      restricted_at: user.restricted_at,
      created_at: user.created_at,
      last_active: user.last_active,
      is_online: isOnline,
      company: user.company ? { company_id: Number(user.company.company_id), company_name: user.company.name, subscription_tier: user.company.subscription_tier } : null,
      bizcards: user.bizcards.map(b => ({ bizcard_id: Number(b.bizcard_id), bizcard_name: b.bizcard_name, url_alias: b.url_alias, created_at: b.created_at })),
    };
  }

  private async findPlanByTier(tier: SubscriptionTier, tx: Prisma.TransactionClient): Promise<{ id: bigint; name: string } | null> {
    return tx.subscriptionPlan.findFirst({
      where: {
        is_active: true,
        name: {
          in: planNameCandidates(tier),
        },
      },
      select: { id: true, name: true },
      orderBy: { id: "asc" },
    });
  }

  async updateClient(
    clientId: number,
    updates: {
      first_name?: string;
      last_name?: string;
      email?: string;
      alt_email?: string;
      phone?: string;
      subscription_tier?: string;
      password?: string;
    },
    performedBy: string,
    context?: { ipAddress?: string; userAgent?: string }
  ): Promise<{
    user_id: number;
    first_name: string;
    last_name: string;
    email: string;
    alt_email: string | null;
    phone: string | null;
    subscription_tier: string;
    subscription_expiry: Date | null;
    updated_fields: string[];
  }> {
    const existing = await prisma.user.findFirst({
      where: { user_id: BigInt(clientId), role: "user" },
      select: {
        user_id: true,
        first_name: true,
        last_name: true,
        email: true,
        alt_email: true,
        contact: true,
      },
    });

    if (!existing) {
      throw createClientError(ClientErrorCode.CLIENT_NOT_FOUND, `Client with ID ${clientId} not found`, 404, this.requestId, { clientId });
    }

    const updatedFields: string[] = [];
    const data: Prisma.UserUpdateInput = {};

    if (typeof updates.first_name === "string" && updates.first_name.trim()) {
      data.first_name = updates.first_name.trim();
      updatedFields.push("first_name");
    }
    if (typeof updates.last_name === "string" && updates.last_name.trim()) {
      data.last_name = updates.last_name.trim();
      updatedFields.push("last_name");
    }
    if (typeof updates.email === "string" && updates.email.trim()) {
      data.email = updates.email.trim().toLowerCase();
      updatedFields.push("email");
    }
    if (typeof updates.alt_email === "string") {
      data.alt_email = normalizeClientAltEmail(updates.alt_email, this.requestId);
      updatedFields.push("alt_email");
    }
    if (typeof updates.phone === "string") {
      data.contact = normalizeClientPhone(updates.phone, this.requestId);
      updatedFields.push("phone");
    }

    let subscriptionTierUpdate: SubscriptionTier | null = null;
    if (typeof updates.subscription_tier === "string" && updates.subscription_tier.trim()) {
      const tier = normalizeTierValue(updates.subscription_tier);
      if (!tier) {
        throw createClientError(ClientErrorCode.INVALID_PAGINATION, "Invalid subscription tier. Allowed: free, basic, premium, enterprise.", 400, this.requestId, { subscription_tier: updates.subscription_tier });
      }
      subscriptionTierUpdate = tier;
      updatedFields.push("subscription_tier");
    }

    // Password update support (hash + encrypted vault for authorized SA viewing)
    let passwordPayload: Awaited<ReturnType<typeof import("@/server/lib/password-vault").buildPasswordCredentialPayload>> | null = null;
    if (typeof updates.password === "string" && updates.password.trim()) {
      const passwordValue = updates.password.trim();
      if (passwordValue.length < 8) {
        throw createClientError(ClientErrorCode.INVALID_PAGINATION, "Password must be at least 8 characters long.", 400, this.requestId);
      }
      if (passwordValue.length > 128) {
        throw createClientError(ClientErrorCode.INVALID_PAGINATION, "Password must not exceed 128 characters.", 400, this.requestId);
      }
      const { buildPasswordCredentialPayload } = await import("@/server/lib/password-vault");
      passwordPayload = await buildPasswordCredentialPayload(passwordValue, this.requestId);
      updatedFields.push("password");
    }

    if (updatedFields.length === 0) {
      throw createClientError(ClientErrorCode.INVALID_PAGINATION, "No valid update fields were provided", 400, this.requestId);
    }

    const result = await prisma.$transaction(async (tx) => {
      let nextUser = existing;
      if (Object.keys(data).length > 0) {
        nextUser = await tx.user.update({
          where: { user_id: existing.user_id },
          data,
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            email: true,
            alt_email: true,
            contact: true,
          },
        });
      }

      // Update password if provided
      if (passwordPayload) {
        await tx.credential.upsert({
          where: { user_id: existing.user_id },
          update: {
            password_hash: passwordPayload.password_hash,
            password_encrypted: passwordPayload.password_encrypted,
            password_changed_at: passwordPayload.password_changed_at,
            updated_at: passwordPayload.updated_at,
          },
          create: {
            user_id: existing.user_id,
            password_hash: passwordPayload.password_hash,
            password_encrypted: passwordPayload.password_encrypted,
            password_changed_at: passwordPayload.password_changed_at,
            email_verified: true,
            email_verified_at: new Date(),
          },
        });
      }

      // Sync updates to Bizcard table for existing users
      // This ensures that profile updates are reflected on the public alias URL
      if (Object.keys(data).length > 0) {
        const bizcardData: Prisma.BizcardUpdateManyMutationInput = {
          updated_at: new Date(),
        };

        if (data.first_name) bizcardData.first_name = data.first_name as string;
        if (data.last_name) bizcardData.last_name = data.last_name as string;
        if (data.email) bizcardData.email = data.email as string;
        if (data.alt_email !== undefined) {
          bizcardData.alt_email = (data.alt_email as string | null) ?? null;
        }
        if (data.contact !== undefined) {
          const contactValue = (data.contact as string | null) ?? null;
          if (contactValue !== null) {
            bizcardData.contact_number = contactValue;
          }
        }

        await tx.bizcard.updateMany({
          where: { user_id: existing.user_id, deactivated_flag: false },
          data: bizcardData,
        });
      }

      if (subscriptionTierUpdate) {
        const plan = await this.findPlanByTier(subscriptionTierUpdate, tx);
        if (!plan) {
          throw createClientError(ClientErrorCode.INVALID_PAGINATION, `Subscription plan '${subscriptionTierUpdate}' is not configured`, 400, this.requestId, { subscription_tier: subscriptionTierUpdate });
        }

        const bizcards = await tx.bizcard.findMany({
          where: { user_id: existing.user_id, deactivated_flag: false },
          select: { bizcard_id: true },
        });

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        for (const bizcard of bizcards) {
          await tx.bizcardSubscription.upsert({
            where: { bizcard_id: bizcard.bizcard_id },
            create: {
              bizcard_id: bizcard.bizcard_id,
              plan_id: plan.id,
              status: "active",
              billing_cycle: "monthly",
              started_at: now,
              expires_at: expiresAt,
              auto_renew: true,
            },
            update: {
              plan_id: plan.id,
              status: "active",
              expires_at: expiresAt,
              auto_renew: true,
            },
          });

          await tx.bizcard.update({
            where: { bizcard_id: bizcard.bizcard_id },
            data: {
              subscription_tier: subscriptionTierUpdate,
              subscription_started_at: now,
              subscription_expires_at: expiresAt,
              subscription_status: "active",
            },
          });
        }
      }

      const subInfo = await getUserSubscriptionInfo(existing.user_id);

      await tx.clientAuditLog.create({
        data: {
          client_user_id: existing.user_id,
          action: "update",
          performed_by: BigInt(performedBy),
          old_values: toJsonString({
            first_name: existing.first_name,
            last_name: existing.last_name,
            email: existing.email,
            alt_email: existing.alt_email,
            phone: existing.contact,
            subscription_tier: subInfo.tier,
            subscription_expiry: subInfo.expiry,
          }),
          new_values: toJsonString({
            first_name: nextUser.first_name,
            last_name: nextUser.last_name,
            email: nextUser.email,
            alt_email: nextUser.alt_email,
            phone: nextUser.contact,
            subscription_tier: subInfo.tier,
            subscription_expiry: subInfo.expiry,
          }),
          ip_address: context?.ipAddress ?? null,
          user_agent: context?.userAgent ?? null,
          request_id: this.requestId,
        },
      });

      return { ...nextUser, subscriptionInfo: subInfo };
    });

    return {
      user_id: Number(result.user_id),
      first_name: result.first_name,
      last_name: result.last_name,
      email: result.email,
      alt_email: result.alt_email,
      phone: result.contact,
      subscription_tier: result.subscriptionInfo.tier,
      subscription_expiry: result.subscriptionInfo.expiry,
      updated_fields: updatedFields,
    };
  }

  async restrictClient(
    clientId: number,
    durationDays: number,
    reason: string,
    performedBy: string,
    context?: { ipAddress?: string; userAgent?: string }
  ): Promise<{
    user_id: number;
    is_restricted: boolean;
    restriction_reason: string | null;
    restricted_until: Date | null;
    restricted_at: Date | null;
    restricted_by: string;
    message: string;
  }> {
    if (!Number.isInteger(durationDays) || durationDays <= 0 || durationDays > 365) {
      throw createClientError(ClientErrorCode.INVALID_RESTRICTION_DURATION, "Restriction duration must be between 1 and 365 days", 400, this.requestId, { durationDays, min: 1, max: 365 });
    }

    const client = await prisma.user.findFirst({
      where: { user_id: BigInt(clientId), role: "user" },
      select: { user_id: true, is_restricted: true, restriction_reason: true, restricted_until: true },
    });
    if (!client) throw createClientError(ClientErrorCode.CLIENT_NOT_FOUND, `Client with ID ${clientId} not found`, 404, this.requestId, { clientId });
    if (isEffectivelyRestricted(client.is_restricted, client.restricted_until)) {
      throw createClientError(ClientErrorCode.CLIENT_ALREADY_RESTRICTED, "Client is already restricted", 409, this.requestId, { clientId, restrictedUntil: client.restricted_until });
    }

    const restrictedUntil = new Date();
    restrictedUntil.setDate(restrictedUntil.getDate() + durationDays);

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.user.update({
        where: { user_id: client.user_id },
        data: {
          is_restricted: true,
          restriction_reason: reason,
          restricted_until: restrictedUntil,
          restricted_by: BigInt(performedBy),
          restricted_at: new Date(),
        },
        select: { user_id: true, is_restricted: true, restriction_reason: true, restricted_until: true, restricted_at: true },
      });
      await tx.clientAuditLog.create({
        data: {
          client_user_id: client.user_id,
          action: "restrict",
          performed_by: BigInt(performedBy),
          old_values: toJsonString({ is_restricted: client.is_restricted, restriction_reason: client.restriction_reason, restricted_until: client.restricted_until }),
          new_values: toJsonString({ is_restricted: true, restriction_reason: reason, restricted_until: restrictedUntil }),
          ip_address: context?.ipAddress ?? null,
          user_agent: context?.userAgent ?? null,
          request_id: this.requestId,
        },
      });
      return next;
    });

    return {
      user_id: Number(updated.user_id),
      is_restricted: updated.is_restricted,
      restriction_reason: updated.restriction_reason,
      restricted_until: updated.restricted_until,
      restricted_at: updated.restricted_at,
      restricted_by: performedBy,
      message: `Client has been restricted for ${durationDays} day(s)`,
    };
  }

  async unrestrictClient(
    clientId: number,
    performedBy: string,
    context?: { ipAddress?: string; userAgent?: string }
  ): Promise<{
    user_id: number;
    is_restricted: boolean;
    restriction_reason: null;
    restricted_until: null;
    message: string;
  }> {
    const client = await prisma.user.findFirst({
      where: { user_id: BigInt(clientId), role: "user" },
      select: { user_id: true, is_restricted: true, restriction_reason: true, restricted_until: true },
    });
    if (!client) throw createClientError(ClientErrorCode.CLIENT_NOT_FOUND, `Client with ID ${clientId} not found`, 404, this.requestId, { clientId });
    if (!isEffectivelyRestricted(client.is_restricted, client.restricted_until)) {
      throw createClientError(ClientErrorCode.CLIENT_NOT_RESTRICTED, "Client is not currently restricted", 409, this.requestId, { clientId });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.user.update({
        where: { user_id: client.user_id },
        data: {
          is_restricted: false,
          restriction_reason: null,
          restricted_until: null,
          restricted_by: null,
          restricted_at: null,
        },
        select: { user_id: true, is_restricted: true },
      });
      await tx.clientAuditLog.create({
        data: {
          client_user_id: client.user_id,
          action: "unrestrict",
          performed_by: BigInt(performedBy),
          old_values: toJsonString({ is_restricted: client.is_restricted, restriction_reason: client.restriction_reason, restricted_until: client.restricted_until }),
          new_values: toJsonString({ is_restricted: false, restriction_reason: null, restricted_until: null }),
          ip_address: context?.ipAddress ?? null,
          user_agent: context?.userAgent ?? null,
          request_id: this.requestId,
        },
      });
      return next;
    });

    return {
      user_id: Number(updated.user_id),
      is_restricted: updated.is_restricted,
      restriction_reason: null,
      restricted_until: null,
      message: "Client restriction has been removed",
    };
  }

  async getClientPortfolioUrl(clientId: number): Promise<{ portfolio_url: string; client_name: string; bizcard_name: string }> {
    const client = await prisma.user.findFirst({
      where: { user_id: BigInt(clientId), role: "user" },
      select: {
        user_id: true,
        first_name: true,
        last_name: true,
        bizcards: {
          where: { deactivated_flag: false, url_alias: { not: null } },
          orderBy: { created_at: "desc" },
          take: 1,
          select: { bizcard_name: true, url_alias: true },
        },
      },
    });
    if (!client) throw createClientError(ClientErrorCode.CLIENT_NOT_FOUND, `Client with ID ${clientId} not found`, 404, this.requestId, { clientId });
    const bizcard = client.bizcards[0];
    if (!bizcard?.url_alias) throw createClientError(ClientErrorCode.CLIENT_NOT_FOUND, "Client does not have an active bizcard", 404, this.requestId, { clientId });

    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
    return {
      portfolio_url: `${baseUrl}/${bizcard.url_alias}`,
      client_name: `${client.first_name} ${client.last_name}`.trim(),
      bizcard_name: bizcard.bizcard_name,
    };
  }

  async exportClients(
    filters: ClientExportFilters,
    format: ExportFormat = "csv"
  ): Promise<Buffer> {
    try {
      const now = new Date();
      const status = filters.status ?? "all";
      const search = normalizeSearch(filters.search ?? filters.filter ?? filters.client_name);
      const subscriptionTier = normalizeSubscriptionFilter(filters.subscription_type);
      const dateRange = resolveClientExportDateRange(
        filters.date_filter,
        filters.start_date,
        filters.end_date,
        this.requestId
      );

      const andClauses: Prisma.UserWhereInput[] = [{ role: "user" }];

      if (dateRange) {
        andClauses.push({ created_at: { gte: dateRange.start, lte: dateRange.end } });
      }

      if (status === "active") {
        andClauses.push({ is_active: true });
        andClauses.push({ OR: [{ is_restricted: false }, { restricted_until: { lt: now } }] });
      } else if (status === "restricted") {
        andClauses.push({ is_restricted: true });
        andClauses.push({ OR: [{ restricted_until: null }, { restricted_until: { gt: now } }] });
      }

      if (search) {
        andClauses.push({
          OR: [
            { first_name: { contains: search } },
            { last_name: { contains: search } },
            { email: { contains: search } },
          ],
        });
      }

      if (subscriptionTier) {
        const subs = await prisma.bizcardSubscription.findMany({
          where: {
            status: "active",
            expires_at: { gt: now },
            plan: { name: { in: planNameCandidates(subscriptionTier) } },
          },
          select: { bizcard: { select: { user_id: true } } },
          distinct: ["bizcard_id"],
        });
        const userIdsWithTier = subs
          .map(s => s.bizcard?.user_id)
          .filter((id): id is bigint => id !== null);
        if (userIdsWithTier.length > 0) {
          andClauses.push({ user_id: { in: userIdsWithTier } });
        } else {
          return Buffer.from("No matching clients\n", "utf8");
        }
      }

      const where: Prisma.UserWhereInput = { AND: andClauses };
      const total = await prisma.user.count({ where });

      if (total > MAX_EXPORT_ROWS) {
        throw createClientError(ClientErrorCode.EXPORT_TOO_LARGE, `Export exceeds maximum row limit (${MAX_EXPORT_ROWS})`, 413, this.requestId, { total, maxRows: MAX_EXPORT_ROWS });
      }

      const rows = await prisma.user.findMany({
        where,
        orderBy: { created_at: "desc" },
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
          email: true,
          is_active: true,
          is_restricted: true,
          restricted_until: true,
          created_at: true,
          last_active: true,
          profile_url: true,
          company: { select: { name: true } },
        },
      });

      const userIds = rows.map(r => r.user_id);
      const subInfos = new Map<bigint, { tier: SubscriptionTier; expiry: Date | null }>();
      if (userIds.length > 0) {
        const subs = await prisma.bizcardSubscription.findMany({
          where: {
            bizcard: { user_id: { in: userIds }, deactivated_flag: false },
            status: "active",
          },
          select: {
            plan: { select: { name: true } },
            bizcard: { select: { user_id: true } },
            expires_at: true,
          },
        });
        for (const sub of subs) {
          const uid = sub.bizcard?.user_id;
          if (uid === null) continue;
          const tier = normalizeTierValue(sub.plan?.name?.toLowerCase() || "free") || "free";
          const existing = subInfos.get(uid);
          if (!existing || tier === "premium" || tier === "enterprise") {
            subInfos.set(uid, { tier, expiry: sub.expires_at });
          }
        }
        for (const uid of userIds) {
          if (!subInfos.has(uid)) {
            subInfos.set(uid, { tier: "free", expiry: null });
          }
        }
      }

      const exportRows = rows.map((row) => {
        const info = subInfos.get(row.user_id) || { tier: "free", expiry: null };
        return {
          user_id: Number(row.user_id),
          name: `${row.first_name} ${row.last_name}`.trim(),
          email: row.email,
          company: row.company?.name ?? "N/A",
          subscription: info.tier,
          status: resolveStatus(row.is_active, row.is_restricted, row.restricted_until),
          created_at: row.created_at.toISOString(),
          last_active: row.last_active ? row.last_active.toISOString() : "Never",
          profile_image: row.profile_url ?? "N/A",
        };
      });

      if (format === "xlsx") {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("Clients");
        worksheet.columns = [
          { header: "User ID", key: "user_id", width: 12 },
          { header: "Name", key: "name", width: 28 },
          { header: "Email", key: "email", width: 32 },
          { header: "Company", key: "company", width: 28 },
          { header: "Subscription", key: "subscription", width: 14 },
          { header: "Status", key: "status", width: 12 },
          { header: "Created At", key: "created_at", width: 28 },
          { header: "Last Active", key: "last_active", width: 28 },
          { header: "Profile Image", key: "profile_image", width: 42 },
        ];
        for (const row of exportRows) worksheet.addRow(row);
        const buffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(buffer as ArrayBuffer);
      }

      const headers = ["User ID", "Name", "Email", "Company", "Subscription", "Status", "Created At", "Last Active", "Profile Image"];
      const csvLines = [
        headers.join(","),
        ...exportRows.map(row =>
          [row.user_id, row.name, row.email, row.company, row.subscription, row.status, row.created_at, row.last_active, row.profile_image]
            .map(escapeCsv)
            .join(",")
        ),
      ];
      return Buffer.from(csvLines.join("\n"), "utf8");
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw createClientError(ClientErrorCode.EXPORT_GENERATION_FAILED, "Failed to generate client export", 500, this.requestId);
    }
  }
}