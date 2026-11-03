import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { isUserCurrentlyOnline } from "@/server/lib/user-presence";
import { prismaAnalytics } from "@/server/lib/prisma-analytics";
import { getMetricsSummary } from "@/middleware/performance";
import {
  SuperAdminErrorCode,
  createSuperAdminError,
} from "@/lib/errors/superadmin-errors";
import {
  type SuperAdminDateRange,
  calculatePercentageChange,
  getTrendDirection,
  toIsoDateInTimezone,
} from "@/lib/utils/superadmin-date-range";
import { REVENUE_RECOGNIZED_STATUSES } from "@/server/lib/marketplace/order-fulfillment";

// Raised from 100 → 10000 so the Super Admin Users feature can retrieve the
// full user list in a single request and support search across all records.
const MAX_PAGE_SIZE = 10000;
const MAX_ACTIVITY_FETCH = 1000;

type SortDirection = "asc" | "desc";
type TrendDirection = "up" | "down" | "same";

type CanonicalOrderStatus =
  | "pending"
  | "pending_payment"
  | "processing"
  | "shipped"
  | "delivered"
  | "completed"
  | "payment_failed"
  | "cancelled"
  | "refunded";

const ORDER_STATUS_ALIASES: Record<string, CanonicalOrderStatus> = {
  paid: "completed",
  in_progress: "processing",
  awaiting_payment: "pending_payment",
  failed: "payment_failed",
  canceled: "cancelled",
};

const CANONICAL_ORDER_STATUSES = new Set<CanonicalOrderStatus>([
  "pending",
  "pending_payment",
  "processing",
  "shipped",
  "delivered",
  "completed",
  "payment_failed",
  "cancelled",
  "refunded",
]);

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value instanceof Prisma.Decimal) {
    return Number(value);
  }
  return 0;
}

function clampPage(value: number): number {
  if (!Number.isInteger(value) || value < 1) return 1;
  return value;
}

function clampLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1) return 20;
  return Math.min(value, MAX_PAGE_SIZE);
}

function safeJsonParse(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function summarizeDetails(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 220) return trimmed;
  return `${trimmed.slice(0, 217)}...`;
}

function normalizeOrderStatus(status: string | undefined): CanonicalOrderStatus | null {
  if (!status || status === "all") return null;
  const lowered = status.trim().toLowerCase();
  if (lowered in ORDER_STATUS_ALIASES) {
    return ORDER_STATUS_ALIASES[lowered];
  }
  if (CANONICAL_ORDER_STATUSES.has(lowered as CanonicalOrderStatus)) {
    return lowered as CanonicalOrderStatus;
  }
  return null;
}

function deriveTransactionType(itemTypes: string[]): string {
  if (itemTypes.length === 0) return "unknown";

  const normalized = new Set<string>();
  for (const value of itemTypes) {
    const lowered = value.toLowerCase();
    if (lowered.includes("subscription")) {
      normalized.add("subscription");
      continue;
    }
    if (lowered.includes("template") || lowered.includes("theme")) {
      normalized.add("template");
      continue;
    }
    if (lowered.includes("merch") || lowered.includes("product") || lowered.includes("item")) {
      normalized.add("merchandise");
      continue;
    }
    normalized.add("other");
  }

  if (normalized.size > 1) return "mixed";
  return [...normalized][0] ?? "unknown";
}

function normalizeTrend(
  current: number,
  previous: number,
): {
  current: number;
  previous: number;
  percentage_change: number;
  direction: TrendDirection;
} {
  return {
    current,
    previous,
    percentage_change: calculatePercentageChange(current, previous),
    direction: getTrendDirection(current, previous),
  };
}

async function countTierUsersInRange(range: { start: Date; end: Date }) {
  // Only count users who registered within the selected time span.
  const registeredUsers = await prisma.user.findMany({
    where: {
      created_at: {
        gte: range.start,
        lte: range.end,
      },
    },
    select: {
      user_id: true,
      bizcards: {
        where: {
          is_blank: false,
          deleted_at: null,
        },
        select: {
          subscription_tier: true,
          marketplaceSubscription: {
            select: {
              status: true,
              plan: { select: { tier_code: true, name: true } },
            },
          },
        },
        orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
        take: 3,
      },
    },
  });

  const basic = new Set<string>();
  const standard = new Set<string>();
  const premium = new Set<string>();

  for (const user of registeredUsers) {
    const id = user.user_id.toString();
    let tierCode = "";

    for (const card of user.bizcards) {
      const activeSub =
        card.marketplaceSubscription?.status === "active"
          ? card.marketplaceSubscription
          : null;
      const fromSub = activeSub?.plan?.tier_code ?? activeSub?.plan?.name ?? "";
      const fromCard = card.subscription_tier ?? "";
      tierCode = String(fromSub || fromCard).toLowerCase();
      if (tierCode) break;
    }

    if (!tierCode) {
      basic.add(id);
      continue;
    }

    if (tierCode === "basic" || tierCode.includes("basic")) {
      basic.add(id);
    } else if (
      tierCode === "standard" ||
      tierCode === "free_trial" ||
      tierCode === "free" ||
      tierCode.includes("standard") ||
      tierCode.includes("trial")
    ) {
      standard.add(id);
    } else if (
      tierCode === "premium" ||
      tierCode === "enterprise" ||
      tierCode.includes("premium") ||
      tierCode.includes("enterprise")
    ) {
      premium.add(id);
    } else {
      basic.add(id);
    }
  }

  return {
    basic: basic.size,
    standard: standard.size,
    premium: premium.size,
  };
}

function toSourceSummary(entries: Array<{ source: string }>): Record<string, number> {
  return entries.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.source] = (acc[entry.source] ?? 0) + 1;
    return acc;
  }, {});
}

function isPoolTimeoutError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2024"
  );
}

export interface DashboardMetricsResult {
  totals: {
    total_users: number;
    total_orders: number;
    total_revenue: number;
    total_companies: number;
    total_affiliates: number;
    pending_company_requests: number;
  };
  comparisons: {
    users: { current: number; previous: number; percentage_change: number; direction: TrendDirection };
    orders: { current: number; previous: number; percentage_change: number; direction: TrendDirection };
    revenue: { current: number; previous: number; percentage_change: number; direction: TrendDirection };
    companies: { current: number; previous: number; percentage_change: number; direction: TrendDirection };
  };
  user_tier_trend: Array<{
    key: "new_users" | "basic" | "standard" | "premium";
    label: string;
    current: number;
    previous: number;
    change: number;
    percentage_change: number;
  }>;
}

export interface ActivityFilters {
  page: number;
  limit: number;
  dateRange: SuperAdminDateRange;
  activityType?: string;
}

export interface UsersFilters {
  page: number;
  limit: number;
  search?: string;
  status?: "all" | "active" | "restricted";
  role?: "all" | "user" | "staff" | "admin" | "super_admin" | "company_admin" | "dev";
  subscriptionType?: string;
  sortBy?: "created_at" | "last_active" | "name" | "email";
  sortDir?: SortDirection;
  dateRange?: SuperAdminDateRange;
}

export interface StaffActivityFilters {
  page: number;
  limit: number;
  dateRange: SuperAdminDateRange;
  search?: string;
}

export interface RecentOrdersFilters {
  page: number;
  limit: number;
  dateRange: SuperAdminDateRange;
  search?: string;
  status?: string;
}

interface UnifiedActivity {
  id: string;
  source: string;
  activity_type: string;
  description: string | null;
  actor: {
    user_id: string | null;
    name: string;
    email: string | null;
  };
  target: {
    type: string;
    id: string | null;
    label: string | null;
  };
  details: Record<string, unknown> | null;
  created_at: string;
}

interface UnifiedStaffActivity {
  id: string;
  source: string;
  action: string;
  description: string | null;
  staff: {
    user_id: string;
    name: string;
    email: string;
  };
  target: {
    type: string;
    id: string | null;
    label: string | null;
  };
  details: Record<string, unknown> | null;
  created_at: string;
}

export class SuperAdminDashboardService {
  private readonly requestId: string;

  constructor(requestId: string) {
    this.requestId = requestId;
  }

  async getDashboardMetrics(dateRange: SuperAdminDateRange): Promise<DashboardMetricsResult> {
    try {
      const [
        allTimeTotalUsers,
        currentUsers,
        previousUsers,
        currentOrders,
        previousOrders,
        currentCompanies,
        previousCompanies,
        totalAffiliates,
        pendingJoinRequests,
        pendingNameChangeRequests,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({
          where: {
            created_at: {
              gte: dateRange.start,
              lte: dateRange.end,
            },
          },
        }),
        prisma.user.count({
          where: {
            created_at: {
              gte: dateRange.previousStart,
              lte: dateRange.previousEnd,
            },
          },
        }),
        prisma.shopOrder.aggregate({
          where: {
            placed_at: {
              gte: dateRange.start,
              lte: dateRange.end,
            },
          },
          _count: { _all: true },
          _sum: { total_amount: true },
        }),
        prisma.shopOrder.aggregate({
          where: {
            placed_at: {
              gte: dateRange.previousStart,
              lte: dateRange.previousEnd,
            },
          },
          _count: { _all: true },
          _sum: { total_amount: true },
        }),
        prisma.company.count({
          where: {
            created_at: {
              gte: dateRange.start,
              lte: dateRange.end,
            },
          },
        }),
        prisma.company.count({
          where: {
            created_at: {
              gte: dateRange.previousStart,
              lte: dateRange.previousEnd,
            },
          },
        }),
        prisma.user.count({ where: { is_affiliate: true } }),
        prisma.companyJoinRequest.count({ where: { status: "pending" } }),
        prisma.companyNameChangeRequest.count({ where: { status: "pending" } }),
      ]);

      const currentOrderCount = currentOrders._count._all;
      const previousOrderCount = previousOrders._count._all;

      // Revenue only counts orders whose payment has been confirmed. Abandoned /
      // unpaid invoices (pending_payment) must not inflate the headline revenue.
      const [currentPaidRevenue, previousPaidRevenue] = await Promise.all([
        prisma.shopOrder.aggregate({
          where: {
            placed_at: { gte: dateRange.start, lte: dateRange.end },
            status: { in: REVENUE_RECOGNIZED_STATUSES },
          },
          _sum: { total_amount: true },
        }),
        prisma.shopOrder.aggregate({
          where: {
            placed_at: { gte: dateRange.previousStart, lte: dateRange.previousEnd },
            status: { in: REVENUE_RECOGNIZED_STATUSES },
          },
          _sum: { total_amount: true },
        }),
      ]);
      const currentRevenue = toNumber(currentPaidRevenue._sum.total_amount);
      const previousRevenue = toNumber(previousPaidRevenue._sum.total_amount);

      const [currentTiers, previousTiers] = await Promise.all([
        countTierUsersInRange({ start: dateRange.start, end: dateRange.end }),
        countTierUsersInRange({
          start: dateRange.previousStart,
          end: dateRange.previousEnd,
        }),
      ]);

      const tierBars: DashboardMetricsResult["user_tier_trend"] = [
        {
          key: "new_users",
          label: "New Users",
          current: currentUsers,
          previous: previousUsers,
          change: currentUsers - previousUsers,
          percentage_change: calculatePercentageChange(currentUsers, previousUsers),
        },
        {
          key: "basic",
          label: "Basic Accounts",
          current: currentTiers.basic,
          previous: previousTiers.basic,
          change: currentTiers.basic - previousTiers.basic,
          percentage_change: calculatePercentageChange(currentTiers.basic, previousTiers.basic),
        },
        {
          key: "standard",
          label: "Standard Accounts",
          current: currentTiers.standard,
          previous: previousTiers.standard,
          change: currentTiers.standard - previousTiers.standard,
          percentage_change: calculatePercentageChange(currentTiers.standard, previousTiers.standard),
        },
        {
          key: "premium",
          label: "Premium Accounts",
          current: currentTiers.premium,
          previous: previousTiers.premium,
          change: currentTiers.premium - previousTiers.premium,
          percentage_change: calculatePercentageChange(currentTiers.premium, previousTiers.premium),
        },
      ];

      return {
        totals: {
          total_users: allTimeTotalUsers,
          total_orders: currentOrderCount,
          total_revenue: currentRevenue,
          total_companies: currentCompanies,
          total_affiliates: totalAffiliates,
          pending_company_requests: pendingJoinRequests + pendingNameChangeRequests,
        },
        comparisons: {
          users: normalizeTrend(currentUsers, previousUsers),
          orders: normalizeTrend(currentOrderCount, previousOrderCount),
          revenue: normalizeTrend(currentRevenue, previousRevenue),
          companies: normalizeTrend(currentCompanies, previousCompanies),
        },
        user_tier_trend: tierBars,
      };
    } catch (error) {
      throw createSuperAdminError(
        SuperAdminErrorCode.DASHBOARD_METRICS_FAILED,
        "Failed to load dashboard metrics",
        500,
        this.requestId,
        {
          reason: error instanceof Error ? error.message : "Unknown error",
        },
      );
    }
  }

  async getRecentActivities(filters: ActivityFilters) {
    try {
      const page = clampPage(filters.page);
      const limit = clampLimit(filters.limit);
      const take = Math.min(MAX_ACTIVITY_FETCH, page * limit);

      const createdAtWhere = {
        gte: filters.dateRange.start,
        lte: filters.dateRange.end,
      } as const;

      const [
        adminTotal,
        companyTotal,
        clientTotal,
        orderTotal,
        adminRows,
        companyRows,
        clientRows,
        orderRows,
      ] = await Promise.all([
        prisma.adminAuditLog.count({ where: { created_at: createdAtWhere } }),
        prisma.companyAuditLog.count({ where: { created_at: createdAtWhere } }),
        prisma.clientAuditLog.count({ where: { created_at: createdAtWhere } }),
        prisma.orderStatusAuditLog.count({ where: { changed_at: createdAtWhere } }),
        prisma.adminAuditLog.findMany({
          where: { created_at: createdAtWhere },
          orderBy: { created_at: "desc" },
          take,
          select: {
            id: true,
            admin_user_id: true,
            admin_email: true,
            action: true,
            details: true,
            created_at: true,
          },
        }),
        prisma.companyAuditLog.findMany({
          where: { created_at: createdAtWhere },
          orderBy: { created_at: "desc" },
          take,
          select: {
            log_id: true,
            company_id: true,
            user_id: true,
            action: true,
            details: true,
            created_at: true,
            user: {
              select: {
                first_name: true,
                last_name: true,
                email: true,
              },
            },
          },
        }),
        prisma.clientAuditLog.findMany({
          where: { created_at: createdAtWhere },
          orderBy: { created_at: "desc" },
          take,
          select: {
            log_id: true,
            client_user_id: true,
            performed_by: true,
            action: true,
            old_values: true,
            new_values: true,
            created_at: true,
            performer: {
              select: {
                first_name: true,
                last_name: true,
                email: true,
              },
            },
          },
        }),
        prisma.orderStatusAuditLog.findMany({
          where: { changed_at: createdAtWhere },
          orderBy: { changed_at: "desc" },
          take,
          select: {
            log_id: true,
            order_id: true,
            previous_status: true,
            next_status: true,
            reason: true,
            changed_by: true,
            metadata: true,
            changed_at: true,
            actor: {
              select: {
                first_name: true,
                last_name: true,
                email: true,
              },
            },
            order: {
              select: {
                order_number: true,
              },
            },
          },
        }),
      ]);

      const entries: UnifiedActivity[] = [
        ...adminRows.map((row) => ({
          id: `admin:${row.id.toString()}`,
          source: "admin_audit",
          activity_type: row.action,
          description: summarizeDetails(row.details),
          actor: {
            user_id: row.admin_user_id.toString(),
            name: row.admin_email,
            email: row.admin_email,
          },
          target: {
            type: "system",
            id: null,
            label: null,
          },
          details: safeJsonParse(row.details),
          created_at: row.created_at.toISOString(),
        })),
        ...companyRows.map((row) => ({
          id: `company:${row.log_id.toString()}`,
          source: "company_audit",
          activity_type: row.action,
          description: summarizeDetails(row.details),
          actor: {
            user_id: row.user_id.toString(),
            name: `${row.user.first_name} ${row.user.last_name}`.trim() || row.user.email,
            email: row.user.email,
          },
          target: {
            type: "company",
            id: row.company_id.toString(),
            label: null,
          },
          details: safeJsonParse(row.details),
          created_at: row.created_at.toISOString(),
        })),
        ...clientRows.map((row) => ({
          id: `client:${row.log_id.toString()}`,
          source: "client_audit",
          activity_type: row.action,
          description: row.action,
          actor: {
            user_id: row.performed_by.toString(),
            name: `${row.performer.first_name} ${row.performer.last_name}`.trim() || row.performer.email,
            email: row.performer.email,
          },
          target: {
            type: "client",
            id: row.client_user_id.toString(),
            label: null,
          },
          details: {
            old_values: row.old_values ?? null,
            new_values: row.new_values ?? null,
          },
          created_at: row.created_at.toISOString(),
        })),
        ...orderRows.map((row) => ({
          id: `order:${row.log_id.toString()}`,
          source: "order_status_audit",
          activity_type: "ORDER_STATUS_UPDATED",
          description: row.reason ?? `${row.previous_status ?? "unknown"} -> ${row.next_status}`,
          actor: {
            user_id: row.changed_by.toString(),
            name: `${row.actor.first_name} ${row.actor.last_name}`.trim() || row.actor.email,
            email: row.actor.email,
          },
          target: {
            type: "order",
            id: row.order_id.toString(),
            label: row.order.order_number,
          },
          details: {
            previous_status: row.previous_status,
            next_status: row.next_status,
            metadata: row.metadata ?? null,
          },
          created_at: row.changed_at.toISOString(),
        })),
      ];

      const loweredFilter = filters.activityType?.trim().toLowerCase();
      const filteredEntries = loweredFilter
        ? entries.filter((entry) => {
            const haystack = `${entry.source} ${entry.activity_type} ${entry.description ?? ""}`.toLowerCase();
            return haystack.includes(loweredFilter);
          })
        : entries;

      filteredEntries.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

      const startIndex = (page - 1) * limit;
      const paged = filteredEntries.slice(startIndex, startIndex + limit);
      const estimatedTotal = loweredFilter
        ? filteredEntries.length
        : adminTotal + companyTotal + clientTotal + orderTotal;

      return {
        activities: paged,
        summary: {
          total_activities: estimatedTotal,
          by_source: toSourceSummary(filteredEntries),
        },
      };
    } catch (error) {
      throw createSuperAdminError(
        SuperAdminErrorCode.RECENT_ACTIVITIES_FAILED,
        "Failed to load recent activities",
        500,
        this.requestId,
        {
          reason: error instanceof Error ? error.message : "Unknown error",
        },
      );
    }
  }

  // ─── FIXED getUsers ─────────────────────────────────────────────────────────
  async getUsers(filters: UsersFilters) {
    try {
      const page = clampPage(filters.page);
      const limit = clampLimit(filters.limit);

      const where: Prisma.UserWhereInput = {
        deleted_at: null,
      };

      if (filters.search) {
        where.OR = [
          { first_name: { contains: filters.search } },
          { last_name: { contains: filters.search } },
          { email: { contains: filters.search } },
        ];
      }

      if (filters.status === "active") {
        where.is_active = true;
        where.is_restricted = false;
      } else if (filters.status === "restricted") {
        where.is_restricted = true;
      }

      if (filters.role && filters.role !== "all") {
        where.role = filters.role;
      }

      if (filters.dateRange) {
        where.created_at = {
          gte: filters.dateRange.start,
          lte: filters.dateRange.end,
        };
      }

      // Handle subscription type filter by fetching matching user IDs from bizcardSubscription
      const normalizedSubscriptionType = (filters.subscriptionType ?? "all").toLowerCase();
      if (normalizedSubscriptionType !== "all") {
        let matchingUserIds: bigint[] = [];
        const now = new Date();

        if (normalizedSubscriptionType === "free") {
          // Users with NO active subscription OR with a free plan
          // 1. Get all user IDs
          const allUsers = await prisma.user.findMany({ select: { user_id: true } });
          const allUserIds = allUsers.map(u => u.user_id);

          // 2. Get user IDs that have any active non‑free subscription
          const nonFreeSubs = await prisma.bizcardSubscription.findMany({
            where: {
              status: "active",
              expires_at: { gt: now },
              plan: { name: { not: { equals: "free" } } },
            },
            select: { bizcard: { select: { user_id: true } } },
            distinct: ["bizcard_id"],
          });
          const nonFreeUserIds = nonFreeSubs
            .map(s => s.bizcard?.user_id)
            .filter((id): id is bigint => id !== null);

          // 3. User IDs that have a free active subscription
          const freeSubs = await prisma.bizcardSubscription.findMany({
            where: {
              status: "active",
              expires_at: { gt: now },
              plan: { name: { equals: "free" } },
            },
            select: { bizcard: { select: { user_id: true } } },
            distinct: ["bizcard_id"],
          });
          const freeUserIds = freeSubs
            .map(s => s.bizcard?.user_id)
            .filter((id): id is bigint => id !== null);

          // Users with no active subscription at all (all users minus those with any active subscription)
          const anyActiveSubs = await prisma.bizcardSubscription.findMany({
            where: { status: "active", expires_at: { gt: now } },
            select: { bizcard: { select: { user_id: true } } },
            distinct: ["bizcard_id"],
          });
          const anyActiveUserIds = anyActiveSubs
            .map(s => s.bizcard?.user_id)
            .filter((id): id is bigint => id !== null);
          const noSubUserIds = allUserIds.filter(id => !anyActiveUserIds.includes(id));

          // Combine free + no subscription
          matchingUserIds = [...freeUserIds, ...noSubUserIds];
          matchingUserIds = [...new Set(matchingUserIds)];
        } else {
          // Specific tier
          const subs = await prisma.bizcardSubscription.findMany({
            where: {
              status: "active",
              expires_at: { gt: now },
              plan: { name: { equals: normalizedSubscriptionType } },
            },
            select: { bizcard: { select: { user_id: true } } },
            distinct: ["bizcard_id"],
          });
          matchingUserIds = subs
            .map(s => s.bizcard?.user_id)
            .filter((id): id is bigint => id !== null);
        }

        if (matchingUserIds.length === 0) {
          return {
            users: [],
            summary: { total_users: 0 },
          };
        }
        where.user_id = { in: matchingUserIds };
      }

      const sortBy = filters.sortBy ?? "created_at";
      const sortDir = filters.sortDir ?? "desc";

      const orderBy: Prisma.UserOrderByWithRelationInput =
        sortBy === "last_active"
          ? { last_active: sortDir }
          : sortBy === "name"
            ? { first_name: sortDir }
            : sortBy === "email"
              ? { email: sortDir }
              : { created_at: sortDir };

      const [total, rows] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
          where,
          orderBy,
          skip: (page - 1) * limit,
          take: limit,
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            email: true,
            role: true,
            is_active: true,
            is_restricted: true,
            restricted_until: true,
            created_at: true,
            last_active: true,
            is_online: true,
            company: {
              select: {
                company_id: true,
                name: true,
              },
            },
            _count: {
              select: {
                shopOrders: true,
              },
            },
          },
        }),
      ]);

      // Batch fetch subscription info for these users
      const userIds = rows.map((row) => row.user_id);
      const subInfos = new Map<
        bigint,
        {
          status: string;
          billing_cycle: string | null;
          started_at: Date | null;
          expires_at: Date | null;
          planName: string;
        }
      >();
      if (userIds.length > 0) {
        const subscriptions = await prisma.bizcardSubscription.findMany({
          where: {
            bizcard: { user_id: { in: userIds }, deactivated_flag: false },
            status: "active",
          },
          select: {
            bizcard: { select: { user_id: true } },
            status: true,
            billing_cycle: true,
            started_at: true,
            expires_at: true,
            plan: { select: { name: true } },
          },
          orderBy: { expires_at: "desc" },
        });
        for (const sub of subscriptions) {
          const uid = sub.bizcard?.user_id;
          if (uid && !subInfos.has(uid)) {
            subInfos.set(uid, {
              status: sub.status,
              billing_cycle: sub.billing_cycle,
              started_at: sub.started_at,
              expires_at: sub.expires_at,
              planName: sub.plan?.name ?? "free",
            });
          }
        }
        // For users without any subscription, set default
        for (const uid of userIds) {
          if (!subInfos.has(uid)) {
            subInfos.set(uid, {
              status: "inactive",
              billing_cycle: null,
              started_at: null,
              expires_at: null,
              planName: "free",
            });
          }
        }
      }

      // Fetch order totals for these users
      const orderRollups = userIds.length
        ? await prisma.shopOrder.groupBy({
            by: ["user_id"],
            where: { user_id: { in: userIds } },
            _sum: { total_amount: true },
            _max: { placed_at: true },
          })
        : [];
      const rollupMap = new Map(
        orderRollups.map((row) => [
          row.user_id.toString(),
          {
            totalSpent: toNumber(row._sum.total_amount),
            lastOrderAt: row._max.placed_at,
          },
        ]),
      );

      return {
        users: rows.map((row) => {
          const subInfo = subInfos.get(row.user_id);
          const rollup = rollupMap.get(row.user_id.toString());
          const subscriptionName = subInfo?.planName ?? "free";
          return {
            user_id: row.user_id.toString(),
            name: `${row.first_name} ${row.last_name}`.trim(),
            first_name: row.first_name,
            last_name: row.last_name,
            email: row.email,
            role: row.role,
            is_active: row.is_active,
            is_restricted: row.is_restricted,
            restricted_until: row.restricted_until?.toISOString() ?? null,
            company: row.company
              ? {
                  company_id: row.company.company_id.toString(),
                  company_name: row.company.name,
                }
              : null,
            subscription: {
              type: subscriptionName,
              status: subInfo?.status ?? "inactive",
              billing_cycle: subInfo?.billing_cycle ?? null,
              started_at: subInfo?.started_at?.toISOString() ?? null,
              expires_at: subInfo?.expires_at?.toISOString() ?? null,
            },
            total_orders: row._count.shopOrders,
            total_spent: rollup?.totalSpent ?? 0,
            last_order_at: rollup?.lastOrderAt?.toISOString() ?? null,
            last_active: row.last_active?.toISOString() ?? null,
            is_online: isUserCurrentlyOnline({
              is_online: row.is_online,
              last_active: row.last_active,
            }),
            session_status: isUserCurrentlyOnline({
              is_online: row.is_online,
              last_active: row.last_active,
            })
              ? "online"
              : "offline",
            created_at: row.created_at.toISOString(),
          };
        }),
        summary: {
          total_users: total,
        },
      };
    } catch (error) {
      throw createSuperAdminError(
        SuperAdminErrorCode.USERS_LIST_FAILED,
        "Failed to load users",
        500,
        this.requestId,
        {
          reason: error instanceof Error ? error.message : "Unknown error",
        },
      );
    }
  }

  async getSystemHealth() {
    const checkMainDatabase = async (): Promise<{
      status: "healthy" | "degraded";
      latency_ms: number | null;
      error: string | null;
    }> => {
      const startedAt = Date.now();
      try {
        await prisma.$queryRaw`SELECT 1`;
        return {
          status: "healthy",
          latency_ms: Date.now() - startedAt,
          error: null,
        };
      } catch (error) {
        return {
          status: "degraded",
          latency_ms: null,
          error: error instanceof Error ? error.message : "Main database unavailable",
        };
      }
    };

    const checkAnalyticsDatabase = async (): Promise<{
      status: "healthy" | "degraded";
      latency_ms: number | null;
      error: string | null;
    }> => {
      const startedAt = Date.now();
      try {
        await prismaAnalytics.$queryRaw`SELECT 1`;
        return {
          status: "healthy",
          latency_ms: Date.now() - startedAt,
          error: null,
        };
      } catch (error) {
        return {
          status: "degraded",
          latency_ms: null,
          error: error instanceof Error ? error.message : "Analytics database unavailable",
        };
      }
    };

    const getCookiePreferencesAnalytics = async (): Promise<any> => {
      try {
        const [userPrefsCount, categoryStats, versionStats] = await Promise.all([
          prisma.userCookiePreferences.count(),
          prisma.$queryRaw<any[]>`
            SELECT 
              cc.slug,
              cc.name,
              COUNT(CASE WHEN JSON_EXTRACT(preferences_by_category, CONCAT('$.', cc.slug)) = true THEN 1 END) as opted_in,
              COUNT(*) as total
            FROM user_cookie_preferences ucp
            CROSS JOIN cookie_categories cc
            GROUP BY cc.id, cc.slug, cc.name
          `,
          prisma.$queryRaw<any[]>`
            SELECT consent_version, COUNT(*) as count
            FROM user_cookie_preferences
            GROUP BY consent_version
          `,
        ]);

        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const trendData = await prisma.$queryRaw<any[]>`
          SELECT 
            DATE(created_at) as date,
            COUNT(*) as new_consents
          FROM user_cookie_preferences
          WHERE created_at >= ${thirtyDaysAgo}
          GROUP BY DATE(created_at)
          ORDER BY date ASC
        `;

        const byCategory: Record<string, number> = {};
        let totalCategoryCount = 0;

        for (const stat of categoryStats || []) {
          const rate = stat.total > 0 ? Math.round((stat.opted_in / stat.total) * 10000) / 100 : 0;
          byCategory[stat.slug] = rate;
          totalCategoryCount += stat.total;
        }

        const byVersion: Record<string, number> = {};
        let totalVersionCount = 0;

        for (const versionStat of versionStats || []) {
          const count = Number(versionStat.count) || 0;
          byVersion[versionStat.consent_version] = count;
          totalVersionCount += count;
        }

        const overallConsentRate = userPrefsCount > 0 ? 100 : 0;

        return {
          total_users_with_preferences: userPrefsCount,
          consent_rate: overallConsentRate,
          by_category: byCategory,
          consent_by_version: byVersion,
          preferences_trend_last_30_days: (trendData || []).map((trend: any) => ({
            date: trend.date,
            new_consents: Number(trend.new_consents) || 0,
          })),
        };
      } catch (error) {
        console.error("Failed to calculate cookie preferences analytics:", error);
        return {
          total_users_with_preferences: 0,
          consent_rate: 0,
          by_category: {},
          consent_by_version: {},
          preferences_trend_last_30_days: [],
          error: error instanceof Error ? error.message : "Analytics calculation failed",
        };
      }
    };

    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [mainDb, analyticsDb, metricsSummary, activeAlerts, cookieAnalytics] = await Promise.all([
        checkMainDatabase(),
        checkAnalyticsDatabase(),
        getMetricsSummary(),
        prisma.securityAlert.count({
          where: {
            created_at: {
              gte: oneDayAgo,
            },
          },
        }),
        getCookiePreferencesAnalytics(),
      ]);

      let errorCountLastHour = 0;
      let criticalErrorCountLastHour = 0;

      try {
        [errorCountLastHour, criticalErrorCountLastHour] = await Promise.all([
          prismaAnalytics.systemErrorLog.count({
            where: {
              created_at: {
                gte: oneHourAgo,
              },
            },
          }),
          prismaAnalytics.systemErrorLog.count({
            where: {
              created_at: {
                gte: oneHourAgo,
              },
              severity_level: {
                in: ["critical", "high"],
              },
            },
          }),
        ]);
      } catch (error) {
        if (!isPoolTimeoutError(error)) {
          throw error;
        }
      }

      const requestCount = metricsSummary.totalRequests;
      const errorRatePercent = requestCount > 0
        ? Math.round((errorCountLastHour / requestCount) * 10000) / 100
        : 0;

      const slowRequestRatePercent = requestCount > 0
        ? Math.round((metricsSummary.slowRequests / requestCount) * 10000) / 100
        : 0;

      const healthStatus =
        mainDb.status === "degraded" || analyticsDb.status === "degraded"
          ? "degraded"
          : errorRatePercent > 20 || criticalErrorCountLastHour > 20
            ? "degraded"
            : "healthy";

      return {
        status: healthStatus,
        checked_at: new Date().toISOString(),
        uptime_seconds: Math.floor(process.uptime()),
        api: {
          total_requests: requestCount,
          average_response_time_ms: metricsSummary.averageResponseTime,
          slow_request_count: metricsSummary.slowRequests,
          slow_request_rate_percent: slowRequestRatePercent,
        },
        errors: {
          error_count_last_hour: errorCountLastHour,
          critical_error_count_last_hour: criticalErrorCountLastHour,
          error_rate_percent: errorRatePercent,
        },
        security: {
          active_alerts_last_24h: activeAlerts,
        },
        cookie_preferences_analytics: cookieAnalytics,
        databases: {
          main: mainDb,
          analytics: analyticsDb,
        },
      };
    } catch (error) {
      throw createSuperAdminError(
        SuperAdminErrorCode.SYSTEM_HEALTH_FAILED,
        "Failed to load system health",
        500,
        this.requestId,
        {
          reason: error instanceof Error ? error.message : "Unknown error",
        },
      );
    }
  }

  async getStaffActivities(filters: StaffActivityFilters) {
    try {
      const page = clampPage(filters.page);
      const limit = clampLimit(filters.limit);
      const take = Math.min(MAX_ACTIVITY_FETCH, page * limit);

      const staffProfiles = await prisma.staffProfile.findMany({
        select: {
          staff_id: true,
          user: {
            select: {
              user_id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
        },
      });

      const roleStaff = await prisma.user.findMany({
        where: { role: "staff" },
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
          email: true,
        },
      });

      const adminMap = new Map<string, { name: string; email: string; staff_id?: string }>();
      for (const entry of roleStaff) {
        adminMap.set(entry.user_id.toString(), {
          name: `${entry.first_name} ${entry.last_name}`.trim() || entry.email,
          email: entry.email,
        });
      }
      for (const profile of staffProfiles) {
        adminMap.set(profile.user.user_id.toString(), {
          name: `${profile.user.first_name} ${profile.user.last_name}`.trim() || profile.user.email,
          email: profile.user.email,
          staff_id: profile.staff_id.toString(),
        });
      }

      const superAdminIds = Array.from(adminMap.keys()).map((id) => BigInt(id));

      if (superAdminIds.length === 0) {
        return {
          activities: [] as UnifiedStaffActivity[],
          summary: {
            total_activities: 0,
            unique_staff_count: 0,
            by_source: {},
          },
        };
      }

      const createdAtWhere = {
        gte: filters.dateRange.start,
        lte: filters.dateRange.end,
      } as const;

      const [
        adminAuditTotal,
        clientAuditTotal,
        companyAuditTotal,
        orderAuditTotal,
        joinReviewTotal,
        nameReviewTotal,
        adminAuditRows,
        clientAuditRows,
        companyAuditRows,
        orderAuditRows,
        joinReviewRows,
        nameReviewRows,
      ] = await Promise.all([
        prisma.adminAuditLog.count({
          where: {
            admin_user_id: { in: superAdminIds },
            created_at: createdAtWhere,
          },
        }),
        prisma.clientAuditLog.count({
          where: {
            performed_by: { in: superAdminIds },
            created_at: createdAtWhere,
          },
        }),
        prisma.companyAuditLog.count({
          where: {
            user_id: { in: superAdminIds },
            created_at: createdAtWhere,
          },
        }),
        prisma.orderStatusAuditLog.count({
          where: {
            changed_by: { in: superAdminIds },
            changed_at: createdAtWhere,
          },
        }),
        prisma.companyJoinRequest.count({
          where: {
            reviewed_by: { in: superAdminIds },
            reviewed_at: createdAtWhere,
          },
        }),
        prisma.companyNameChangeRequest.count({
          where: {
            reviewed_by: { in: superAdminIds },
            reviewed_at: createdAtWhere,
          },
        }),
        prisma.adminAuditLog.findMany({
          where: {
            admin_user_id: { in: superAdminIds },
            created_at: createdAtWhere,
          },
          orderBy: { created_at: "desc" },
          take,
          select: {
            id: true,
            admin_user_id: true,
            action: true,
            details: true,
            created_at: true,
          },
        }),
        prisma.clientAuditLog.findMany({
          where: {
            performed_by: { in: superAdminIds },
            created_at: createdAtWhere,
          },
          orderBy: { created_at: "desc" },
          take,
          select: {
            log_id: true,
            client_user_id: true,
            performed_by: true,
            action: true,
            old_values: true,
            new_values: true,
            created_at: true,
          },
        }),
        prisma.companyAuditLog.findMany({
          where: {
            user_id: { in: superAdminIds },
            created_at: createdAtWhere,
          },
          orderBy: { created_at: "desc" },
          take,
          select: {
            log_id: true,
            company_id: true,
            user_id: true,
            action: true,
            details: true,
            created_at: true,
          },
        }),
        prisma.orderStatusAuditLog.findMany({
          where: {
            changed_by: { in: superAdminIds },
            changed_at: createdAtWhere,
          },
          orderBy: { changed_at: "desc" },
          take,
          select: {
            log_id: true,
            order_id: true,
            changed_by: true,
            previous_status: true,
            next_status: true,
            reason: true,
            metadata: true,
            changed_at: true,
            order: {
              select: {
                order_number: true,
              },
            },
          },
        }),
        prisma.companyJoinRequest.findMany({
          where: {
            reviewed_by: { in: superAdminIds },
            reviewed_at: createdAtWhere,
          },
          orderBy: { reviewed_at: "desc" },
          take,
          select: {
            request_id: true,
            company_id: true,
            user_id: true,
            status: true,
            reviewed_by: true,
            reviewed_at: true,
            rejection_reason: true,
          },
        }),
        prisma.companyNameChangeRequest.findMany({
          where: {
            reviewed_by: { in: superAdminIds },
            reviewed_at: createdAtWhere,
          },
          orderBy: { reviewed_at: "desc" },
          take,
          select: {
            request_id: true,
            company_id: true,
            requested_name: true,
            requested_by: true,
            status: true,
            reviewed_by: true,
            reviewed_at: true,
            rejection_reason: true,
          },
        }),
      ]);

      const [staffLogTotal, staffLogRows] = await Promise.all([
        prisma.staffActivityLog.count({
          where: { created_at: createdAtWhere },
        }),
        prisma.staffActivityLog.findMany({
          where: { created_at: createdAtWhere },
          orderBy: { created_at: "desc" },
          take,
          select: {
            log_id: true,
            staff_id: true,
            action: true,
            details: true,
            ip_address: true,
            created_at: true,
            staff: {
              select: {
                user: {
                  select: {
                    user_id: true,
                    first_name: true,
                    last_name: true,
                    email: true,
                  },
                },
              },
            },
          },
        }),
      ]);

      const activities: UnifiedStaffActivity[] = [
        ...staffLogRows.map((row) => {
          const user = row.staff.user;
          return {
            id: `staff-log:${row.log_id.toString()}`,
            source: "staff_activity_log",
            action: row.action,
            description: summarizeDetails(row.details),
            staff: {
              user_id: user.user_id.toString(),
              name: `${user.first_name} ${user.last_name}`.trim() || user.email,
              email: user.email,
            },
            target: {
              type: "system",
              id: row.staff_id.toString(),
              label: "staff",
            },
            details: {
              ...((safeJsonParse(row.details) as Record<string, unknown> | null) ?? {}),
              ip_address: row.ip_address,
            },
            created_at: row.created_at.toISOString(),
          };
        }),
        ...adminAuditRows.map((row) => {
          const staff = adminMap.get(row.admin_user_id.toString());
          return {
            id: `admin:${row.id.toString()}`,
            source: "admin_audit",
            action: row.action,
            description: summarizeDetails(row.details),
            staff: {
              user_id: row.admin_user_id.toString(),
              name: staff?.name ?? "Unknown Staff",
              email: staff?.email ?? "unknown@unknown.local",
            },
            target: {
              type: "system",
              id: null,
              label: null,
            },
            details: safeJsonParse(row.details),
            created_at: row.created_at.toISOString(),
          };
        }),
        ...clientAuditRows.map((row) => {
          const staff = adminMap.get(row.performed_by.toString());
          return {
            id: `client:${row.log_id.toString()}`,
            source: "client_audit",
            action: row.action,
            description: row.action,
            staff: {
              user_id: row.performed_by.toString(),
              name: staff?.name ?? "Unknown Staff",
              email: staff?.email ?? "unknown@unknown.local",
            },
            target: {
              type: "client",
              id: row.client_user_id.toString(),
              label: null,
            },
            details: {
              old_values: row.old_values ?? null,
              new_values: row.new_values ?? null,
            },
            created_at: row.created_at.toISOString(),
          };
        }),
        ...companyAuditRows.map((row) => {
          const staff = adminMap.get(row.user_id.toString());
          return {
            id: `company:${row.log_id.toString()}`,
            source: "company_audit",
            action: row.action,
            description: summarizeDetails(row.details),
            staff: {
              user_id: row.user_id.toString(),
              name: staff?.name ?? "Unknown Staff",
              email: staff?.email ?? "unknown@unknown.local",
            },
            target: {
              type: "company",
              id: row.company_id.toString(),
              label: null,
            },
            details: safeJsonParse(row.details),
            created_at: row.created_at.toISOString(),
          };
        }),
        ...orderAuditRows.map((row) => {
          const staff = adminMap.get(row.changed_by.toString());
          return {
            id: `order:${row.log_id.toString()}`,
            source: "order_status_audit",
            action: "ORDER_STATUS_UPDATED",
            description: row.reason ?? `${row.previous_status ?? "unknown"} -> ${row.next_status}`,
            staff: {
              user_id: row.changed_by.toString(),
              name: staff?.name ?? "Unknown Staff",
              email: staff?.email ?? "unknown@unknown.local",
            },
            target: {
              type: "order",
              id: row.order_id.toString(),
              label: row.order.order_number,
            },
            details: {
              previous_status: row.previous_status,
              next_status: row.next_status,
              metadata: row.metadata ?? null,
            },
            created_at: row.changed_at.toISOString(),
          };
        }),
        ...joinReviewRows
          .filter((row) => row.reviewed_by && row.reviewed_at)
          .map((row) => {
            const staff = adminMap.get(String(row.reviewed_by));
            return {
              id: `join-review:${row.request_id.toString()}`,
              source: "company_join_review",
              action: `JOIN_REQUEST_${row.status.toUpperCase()}`,
              description: row.rejection_reason ?? null,
              staff: {
                user_id: String(row.reviewed_by),
                name: staff?.name ?? "Unknown Staff",
                email: staff?.email ?? "unknown@unknown.local",
              },
              target: {
                type: "company_join_request",
                id: row.request_id.toString(),
                label: `company:${row.company_id.toString()} user:${row.user_id.toString()}`,
              },
              details: row.rejection_reason ? { rejection_reason: row.rejection_reason } : null,
              created_at: row.reviewed_at!.toISOString(),
            };
          }),
        ...nameReviewRows
          .filter((row) => row.reviewed_by && row.reviewed_at)
          .map((row) => {
            const staff = adminMap.get(String(row.reviewed_by));
            return {
              id: `name-review:${row.request_id.toString()}`,
              source: "company_name_change_review",
              action: `COMPANY_NAME_CHANGE_${row.status.toUpperCase()}`,
              description: row.rejection_reason ?? null,
              staff: {
                user_id: String(row.reviewed_by),
                name: staff?.name ?? "Unknown Staff",
                email: staff?.email ?? "unknown@unknown.local",
              },
              target: {
                type: "company_name_change_request",
                id: row.request_id.toString(),
                label: row.requested_name,
              },
              details: {
                requested_name: row.requested_name,
                requested_by: row.requested_by.toString(),
                rejection_reason: row.rejection_reason ?? null,
              },
              created_at: row.reviewed_at!.toISOString(),
            };
          }),
      ];

      const loweredSearch = filters.search?.trim().toLowerCase();
      const filteredActivities = loweredSearch
        ? activities.filter((entry) => {
            const haystack = `${entry.source} ${entry.action} ${entry.description ?? ""} ${entry.staff.name} ${entry.staff.email}`.toLowerCase();
            return haystack.includes(loweredSearch);
          })
        : activities;

      filteredActivities.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

      const startIndex = (page - 1) * limit;
      const pageItems = filteredActivities.slice(startIndex, startIndex + limit);
      const estimatedTotal = loweredSearch
        ? filteredActivities.length
        : adminAuditTotal +
          clientAuditTotal +
          companyAuditTotal +
          orderAuditTotal +
          joinReviewTotal +
          nameReviewTotal +
          staffLogTotal;

      return {
        activities: pageItems,
        summary: {
          total_activities: estimatedTotal,
          unique_staff_count: new Set(pageItems.map((entry) => entry.staff.user_id)).size,
          by_source: toSourceSummary(filteredActivities),
        },
      };
    } catch (error) {
      throw createSuperAdminError(
        SuperAdminErrorCode.STAFF_ACTIVITIES_FAILED,
        "Failed to load staff activities",
        500,
        this.requestId,
        {
          reason: error instanceof Error ? error.message : "Unknown error",
        },
      );
    }
  }

  async getRecentOrders(filters: RecentOrdersFilters) {
    try {
      const page = clampPage(filters.page);
      const limit = clampLimit(filters.limit);

      const normalizedStatus = normalizeOrderStatus(filters.status);
      if (filters.status && filters.status !== "all" && !normalizedStatus) {
        throw createSuperAdminError(
          SuperAdminErrorCode.INVALID_STATUS_FILTER,
          "Invalid status filter",
          400,
          this.requestId,
          { status: filters.status },
        );
      }

      const search = filters.search?.trim();

      const whereBase: Prisma.ShopOrderWhereInput = {
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
        ...(search
          ? {
              OR: [
                { order_number: { contains: search } },
                { payment_id: { contains: search } },
                { xendit_payment_id: { contains: search } },
                { user: { email: { contains: search } } },
                { user: { first_name: { contains: search } } },
                { user: { last_name: { contains: search } } },
              ],
            }
          : {}),
      };

      const currentWhere: Prisma.ShopOrderWhereInput = {
        ...whereBase,
        placed_at: {
          gte: filters.dateRange.start,
          lte: filters.dateRange.end,
        },
      };

      const previousWhere: Prisma.ShopOrderWhereInput = {
        ...whereBase,
        placed_at: {
          gte: filters.dateRange.previousStart,
          lte: filters.dateRange.previousEnd,
        },
      };

      const [total, rows, currentAggregate, previousAggregate, statusBreakdown] = await Promise.all([
        prisma.shopOrder.count({ where: currentWhere }),
        prisma.shopOrder.findMany({
          where: currentWhere,
          orderBy: { placed_at: "desc" },
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            order_number: true,
            user_id: true,
            status: true,
            total_amount: true,
            currency: true,
            payment_method: true,
            payment_id: true,
            xendit_payment_id: true,
            placed_at: true,
            completed_at: true,
            cancelled_at: true,
            refunded_at: true,
            user: {
              select: {
                first_name: true,
                last_name: true,
                email: true,
              },
            },
            items: {
              select: {
                item_type: true,
                item_name: true,
                quantity: true,
                total_price: true,
              },
            },
          },
        }),
        prisma.shopOrder.aggregate({
          where: currentWhere,
          _count: { _all: true },
          _sum: { total_amount: true },
        }),
        prisma.shopOrder.aggregate({
          where: previousWhere,
          _count: { _all: true },
          _sum: { total_amount: true },
        }),
        prisma.shopOrder.groupBy({
          by: ["status"],
          where: currentWhere,
          _count: { _all: true },
        }),
      ]);

      const currentOrderCount = currentAggregate._count._all;
      const previousOrderCount = previousAggregate._count._all;

      // Revenue is recognized only for payment-confirmed orders (never unpaid /
      // abandoned invoices). Order counts above still reflect every order. When
      // the caller already filters by a specific status, respect that filter.
      const revenueStatusFilter: Prisma.ShopOrderWhereInput = normalizedStatus
        ? {}
        : { status: { in: REVENUE_RECOGNIZED_STATUSES } };
      const [currentPaidRevenue, previousPaidRevenue] = await Promise.all([
        prisma.shopOrder.aggregate({
          where: { ...currentWhere, ...revenueStatusFilter },
          _sum: { total_amount: true },
        }),
        prisma.shopOrder.aggregate({
          where: { ...previousWhere, ...revenueStatusFilter },
          _sum: { total_amount: true },
        }),
      ]);
      const currentRevenue = toNumber(currentPaidRevenue._sum.total_amount);
      const previousRevenue = toNumber(previousPaidRevenue._sum.total_amount);

      return {
        orders: rows.map((row) => {
          const itemTypes = row.items.map((item) => item.item_type);
          return {
            order_id: row.id.toString(),
            order_number: row.order_number,
            user_id: row.user_id.toString(),
            customer_name: `${row.user.first_name} ${row.user.last_name}`.trim(),
            customer_email: row.user.email,
            status: row.status,
            transaction_type: deriveTransactionType(itemTypes),
            total_amount: toNumber(row.total_amount),
            currency: row.currency,
            payment_method: row.payment_method ?? null,
            payment_id: row.payment_id ?? row.xendit_payment_id ?? null,
            item_count: row.items.length,
            items: row.items.map((item) => ({
              item_type: item.item_type,
              item_name: item.item_name,
              quantity: item.quantity,
              total_price: toNumber(item.total_price),
            })),
            placed_at: row.placed_at.toISOString(),
            placed_date_local: toIsoDateInTimezone(row.placed_at, filters.dateRange.timezone),
            completed_at: row.completed_at?.toISOString() ?? null,
            cancelled_at: row.cancelled_at?.toISOString() ?? null,
            refunded_at: row.refunded_at?.toISOString() ?? null,
          };
        }),
        summary: {
          total_orders: total,
          total_revenue: currentRevenue,
          status_breakdown: statusBreakdown.map((row) => ({
            status: row.status,
            count: row._count._all,
          })),
        },
        comparisons: {
          orders: normalizeTrend(currentOrderCount, previousOrderCount),
          revenue: normalizeTrend(currentRevenue, previousRevenue),
        },
      };
    } catch (error) {
      if (error instanceof Error && "code" in error && String((error as { code?: string }).code).startsWith("SUPERADMIN_")) {
        throw error;
      }

      throw createSuperAdminError(
        SuperAdminErrorCode.RECENT_ORDERS_FAILED,
        "Failed to load recent orders",
        500,
        this.requestId,
        {
          reason: error instanceof Error ? error.message : "Unknown error",
        },
      );
    }
  }
}