import { Prisma } from "@prisma/client";
import { toJsonString } from "@/server/lib/json-field";
import { AppError } from "@/lib/errors/types";
import { AffiliateMgmtErrorCode, createAffiliateMgmtError } from "@/lib/errors/affiliate-mgmt-errors";
import { prisma } from "@/server/lib/prisma";

export type PeriodType = "today" | "yesterday" | "this_week" | "this_month" | "last_month" | "custom";

export type AffiliateDetailRange = "this_month" | "last_3_months" | "last_6_months" | "last_12_months";

export interface AffiliateListFilters {
  page: number;
  limit: number;
  search?: string;
  status?: "active" | "restricted" | "all";
  sort_by?: "total_earnings" | "total_referrals" | "conversion_rate" | "joined_at" | "successful_referrals";
  sort_dir?: "asc" | "desc";
  period?: PeriodType;
  start_date?: string;
  end_date?: string;
}

export interface AffiliateDashboardSummary {
  total_referral_count: number;
  conversion_rate: number;
  total_paidout: number;
  total_paid: number;
  pending_payout: number;
  active_affiliates: number;
}

export interface AffiliateListItem {
  affiliate_id: number;
  name: string;
  email: string;
  affiliate_code: string | null;
  commission_rate: number;
  joined_at: Date;
  total_referrals: number;
  successful_referrals: number;
  conversion_rate: number;
  total_earnings: number;
  status: "active" | "restricted";
  restricted_until: Date | null;
  profile_image?: string;
  serial_id: string | null;
  subscription: string;
  portfolio_url: string | null;
  tags: string[];
}

export interface AffiliateAnalytics {
  total_referral_count: number;
  conversion_rate: number;
  total_paidouts: number;
  total_paid_affiliates: number;
  pending_payouts: number;
  average_commission_rate: number;
}

export interface AffiliateCommissionListFilters {
  page: number;
  limit: number;
  search?: string;
  status?: "all" | "pending" | "approved" | "paid" | "voided";
  sort_by?: "product_id" | "affiliate_code" | "affiliate_user_id" | "affiliate_name" | "commission_rate" | "commission_amount" | "status";
  sort_dir?: "asc" | "desc";
}

export interface AffiliateCommissionRow {
  commission_id: string;
  product_id: string | null;
  affiliate_code: string | null;
  affiliate_user_id: string;
  affiliate_name: string;
  commission_rate: number;
  commission_amount: number;
  order_total: number;
  order_number: string | null;
  status: string;
  created_at: string;
}

export interface TopPerformingAffiliate {
  affiliate_id: number;
  name: string;
  email: string;
  commission_rate: number;
  total_referrals: number;
  total_earnings: number;
  conversion_rate: number;
  profile_image?: string;
  rank: number;
}

export interface RecentReferral {
  referral_id: number;
  affiliate_id: number;
  affiliate_name: string;
  referred_user_name: string;
  referred_user_email: string;
  converted: boolean;
  order_amount: number | null;
  commission_earned: number;
  referred_at: Date;
  converted_at: Date | null;
}

interface DateRange {
  start: Date;
  end: Date;
}

interface AggregateMetrics {
  totalReferrals: number;
  successfulReferrals: number;
  totalEarnings: number;
}

interface AffiliateActorContext {
  ipAddress?: string;
  userAgent?: string;
}

const APPROVED_COMMISSION_STATUSES = ["approved", "paid"] as const;
const COMPLETED_WITHDRAWAL_STATUSES = ["completed"] as const;
const MAX_EXPORT_ROWS = 25000;
const DEFAULT_COMMISSION_RATE = 5;
const RISING_STAR_MIN_CONVERSIONS = 2;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

interface AffiliateTagContext {
  topReferrerThisMonthId: string | null;
  topReferrerLastMonthId: string | null;
  lastMonthLabel: string;
  biggestContributorId: string | null;
  highEarnerThreshold: number;
  risingStarIds: Set<string>;
  pendingWithdrawalIds: Set<string>;
  clickWithoutConversionIds: Set<string>;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function parseDateInput(value: string | undefined, fieldName: string, requestId: string): Date {
  if (!value) {
    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.INVALID_DATE_RANGE,
      `${fieldName} is required for custom period`,
      400,
      requestId,
      { field: fieldName }
    );
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.INVALID_DATE_RANGE,
      `${fieldName} must be a valid date`,
      400,
      requestId,
      { field: fieldName, value }
    );
  }

  return parsed;
}

function isAffiliateRestrictedNow(isRestricted: boolean, restrictedUntil: Date | null): boolean {
  if (!isRestricted) return false;
  return restrictedUntil === null || restrictedUntil.getTime() > Date.now();
}

function normalizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function toIsoDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function escapeCsv(value: unknown): string {
  const stringValue = value == null ? "" : String(value);
  if (stringValue.includes(",") || stringValue.includes("\"") || stringValue.includes("\n")) {
    return `"${stringValue.replace(/\"/g, '""')}"`;
  }
  return stringValue;
}

export class AffiliateManagementService {
  private readonly requestId: string;

  constructor(requestId: string) {
    this.requestId = requestId;
  }

  private buildAffiliateBaseWhere(): Prisma.UserWhereInput {
    return {
      role: "user",
      AND: [
        {
          OR: [
            { is_affiliate: true },
            { affiliateSettings: { isNot: null } },
            { affiliate_code: { not: null } },
            { affiliates: { some: {} } },
            { affiliateLinks: { some: {} } },
            { referralsAsAffiliate: { some: {} } },
            { commissionsAsAffiliate: { some: {} } },
            { shopCommissionsAsAffiliate: { some: {} } },
            { withdrawals: { some: {} } },
          ],
        },
        // Only affiliates with successful or pending referred orders/commissions.
        {
          OR: [
            {
              referralsAsAffiliate: {
                some: {
                  OR: [
                    { status: { in: ["pending", "converted", "successful", "completed"] } },
                    { conversion_date: { not: null } },
                  ],
                },
              },
            },
            {
              shopCommissionsAsAffiliate: {
                some: { status: { in: ["pending", "approved", "paid"] } },
              },
            },
            {
              commissionsAsAffiliate: {
                some: { status: { in: ["pending", "approved", "paid"] } },
              },
            },
          ],
        },
      ],
    };
  }

  private buildStatusWhere(status: AffiliateListFilters["status"], now: Date): Prisma.UserWhereInput | null {
    if (status === "active") {
      return {
        OR: [
          { is_affiliate_restricted: false },
          { affiliate_restricted_until: { lt: now } },
        ],
      };
    }

    if (status === "restricted") {
      return {
        is_affiliate_restricted: true,
        OR: [{ affiliate_restricted_until: null }, { affiliate_restricted_until: { gt: now } }],
      };
    }

    return null;
  }

  private toAffiliateOrderBy(
    sortBy: AffiliateListFilters["sort_by"],
    sortDir: AffiliateListFilters["sort_dir"]
  ): Prisma.UserOrderByWithRelationInput | Prisma.UserOrderByWithRelationInput[] {
    const direction = sortDir ?? "desc";

    if (sortBy === "total_earnings") {
      return [{ total_affiliate_earnings: direction }, { user_id: "desc" }];
    }

    if (sortBy === "total_referrals" || sortBy === "successful_referrals") {
      return [{ total_successful_referrals: direction }, { user_id: "desc" }];
    }

    if (sortBy === "joined_at") {
      return [{ affiliate_joined_at: direction }, { created_at: direction }];
    }

    return [{ total_successful_referrals: direction }, { total_affiliate_earnings: direction }];
  }

  private getAppBaseUrl(): string {
    return (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  }

  private getDetailDateRange(range: AffiliateDetailRange): DateRange {
    const now = new Date();
    const end = endOfDay(now);

    if (range === "this_month") {
      return {
        start: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)),
        end,
      };
    }

    const monthsBack = range === "last_3_months" ? 3 : range === "last_6_months" ? 6 : 12;
    const start = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);
    return { start: startOfDay(start), end };
  }

  private buildMonthBuckets(range: DateRange): string[] {
    const buckets: string[] = [];
    const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
    const end = new Date(range.end.getFullYear(), range.end.getMonth(), 1);
    while (cursor <= end) {
      const year = cursor.getFullYear();
      const month = String(cursor.getMonth() + 1).padStart(2, "0");
      buckets.push(`${year}-${month}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return buckets;
  }

  private async resolveAffiliateEnrichment(affiliateIds: bigint[]): Promise<{
    portfolioByUser: Map<string, string | null>;
    subscriptionByUser: Map<string, string>;
    serialByUser: Map<string, string | null>;
    profileImageByUser: Map<string, string | null>;
  }> {
    const portfolioByUser = new Map<string, string | null>();
    const subscriptionByUser = new Map<string, string>();
    const serialByUser = new Map<string, string | null>();
    const profileImageByUser = new Map<string, string | null>();

    if (affiliateIds.length === 0) {
      return { portfolioByUser, subscriptionByUser, serialByUser, profileImageByUser };
    }

    const users = await prisma.user.findMany({
      where: { user_id: { in: affiliateIds } },
      select: {
        user_id: true,
        serial_id: true,
        custom_uri: true,
        profile_url: true,
        bizcards: {
          where: { deactivated_flag: false },
          orderBy: { created_at: "desc" },
          take: 3,
          select: {
            url_alias: true,
            serial_id: true,
            profile_img: true,
            subscription_tier: true,
            subscription_status: true,
            marketplaceSubscription: {
              select: {
                status: true,
                plan: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    const baseUrl = this.getAppBaseUrl();

    for (const user of users) {
      const key = user.user_id.toString();
      serialByUser.set(key, user.serial_id ?? user.bizcards.find((b) => b.serial_id)?.serial_id ?? null);

      const aliasCard = user.bizcards.find((b) => b.url_alias);
      if (aliasCard?.url_alias) {
        portfolioByUser.set(key, `${baseUrl}/${aliasCard.url_alias}`);
      } else if (user.custom_uri) {
        portfolioByUser.set(key, `${baseUrl}/${user.custom_uri}`);
      } else if (user.serial_id) {
        portfolioByUser.set(key, `${baseUrl}/${user.serial_id}`);
      } else {
        portfolioByUser.set(key, null);
      }

      const bizcardProfile =
        user.bizcards.find((card) => (card.profile_img ?? "").trim())?.profile_img?.trim() ?? null;
      profileImageByUser.set(key, (user.profile_url ?? "").trim() || bizcardProfile);

      let subscription = "free";
      for (const card of user.bizcards) {
        const marketPlan = card.marketplaceSubscription?.status === "active"
          ? card.marketplaceSubscription.plan?.name
          : null;
        if (marketPlan) {
          subscription = marketPlan;
          break;
        }
        if (card.subscription_status === "active" && card.subscription_tier) {
          subscription = card.subscription_tier;
          break;
        }
        if (card.subscription_tier && subscription === "free") {
          subscription = card.subscription_tier;
        }
      }
      subscriptionByUser.set(key, subscription);
    }

    return { portfolioByUser, subscriptionByUser, serialByUser, profileImageByUser };
  }

  private async buildAffiliateTagContext(): Promise<AffiliateTagContext> {
    const now = new Date();
    const thisMonthStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    const lastMonthStart = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const lastMonthEnd = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
    const risingWindowStart = startOfDay(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
    const trailingYearStart = startOfDay(new Date(now.getFullYear(), now.getMonth() - 11, 1));

    const [
      thisMonthGroups,
      lastMonthGroups,
      revenueGroups,
      paidEarnings,
      risingStars,
      pendingWithdrawals,
      clickOwners,
      convertedOwners,
    ] = await Promise.all([
      prisma.referral.groupBy({
        by: ["affiliate_user_id"],
        where: { conversion_date: { gte: thisMonthStart, lte: endOfDay(now) } },
        _count: { _all: true },
      }),
      prisma.referral.groupBy({
        by: ["affiliate_user_id"],
        where: { conversion_date: { gte: lastMonthStart, lte: lastMonthEnd } },
        _count: { _all: true },
      }),
      prisma.shopCommission.groupBy({
        by: ["affiliate_user_id"],
        where: {
          created_at: { gte: trailingYearStart },
          status: { not: "voided" },
        },
        _sum: { commission_amount: true },
      }),
      prisma.shopCommission.groupBy({
        by: ["affiliate_user_id"],
        where: { status: "paid" },
        _sum: { commission_amount: true },
      }),
      prisma.referral.groupBy({
        by: ["affiliate_user_id"],
        where: {
          conversion_date: { gte: risingWindowStart },
        },
        _count: { _all: true },
      }),
      prisma.withdrawal.findMany({
        where: { status: { in: ["requested", "pending", "processing"] } },
        select: { affiliate_user_id: true },
        distinct: ["affiliate_user_id"],
      }),
      prisma.affiliateClick.groupBy({
        by: ["affiliate_user_id"],
        _count: { _all: true },
      }),
      prisma.referral.groupBy({
        by: ["affiliate_user_id"],
        where: { conversion_date: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const thisMonthLeaders = [...thisMonthGroups].sort((a, b) => b._count._all - a._count._all);
    const lastMonthLeaders = [...lastMonthGroups].sort((a, b) => b._count._all - a._count._all);
    const revenueLeaders = [...revenueGroups].sort(
      (a, b) => Number(b._sum.commission_amount ?? 0) - Number(a._sum.commission_amount ?? 0)
    );

    const paidAmounts = paidEarnings
      .map((row) => Number(row._sum.commission_amount ?? 0))
      .filter((amount) => amount > 0)
      .sort((a, b) => b - a);
    const highEarnerIndex = Math.max(0, Math.ceil(paidAmounts.length * 0.1) - 1);
    const highEarnerThreshold = paidAmounts.length > 0 ? paidAmounts[highEarnerIndex] : Number.POSITIVE_INFINITY;

    const convertedSet = new Set(convertedOwners.map((row) => row.affiliate_user_id.toString()));
    const clickWithoutConversionIds = new Set(
      clickOwners
        .filter((row) => !convertedSet.has(row.affiliate_user_id.toString()))
        .map((row) => row.affiliate_user_id.toString())
    );

    const risingCandidates = risingStars
      .filter((row) => row._count._all >= RISING_STAR_MIN_CONVERSIONS)
      .map((row) => row.affiliate_user_id);
    const firstConversions =
      risingCandidates.length > 0
        ? await prisma.referral.groupBy({
            by: ["affiliate_user_id"],
            where: {
              affiliate_user_id: { in: risingCandidates },
              conversion_date: { not: null },
            },
            _min: { conversion_date: true },
          })
        : [];
    const risingStarIds = new Set(
      firstConversions
        .filter((row) => row._min.conversion_date && row._min.conversion_date >= risingWindowStart)
        .map((row) => row.affiliate_user_id.toString())
    );

    return {
      topReferrerThisMonthId: thisMonthLeaders[0]?.affiliate_user_id.toString() ?? null,
      topReferrerLastMonthId: lastMonthLeaders[0]?.affiliate_user_id.toString() ?? null,
      lastMonthLabel: `Top Referrer in ${MONTH_NAMES[lastMonthStart.getMonth()]}`,
      biggestContributorId: revenueLeaders[0]?.affiliate_user_id.toString() ?? null,
      highEarnerThreshold,
      risingStarIds,
      pendingWithdrawalIds: new Set(pendingWithdrawals.map((row) => row.affiliate_user_id.toString())),
      clickWithoutConversionIds,
    };
  }

  private resolveAffiliateTags(input: {
    affiliateId: string;
    isRestricted: boolean;
    paidEarnings: number;
    tagContext: AffiliateTagContext;
  }): string[] {
    const tags: string[] = [];
    const { affiliateId, isRestricted, paidEarnings, tagContext } = input;

    if (tagContext.topReferrerThisMonthId === affiliateId) {
      tags.push("Top Referrer This Month");
    } else if (tagContext.topReferrerLastMonthId === affiliateId) {
      tags.push(tagContext.lastMonthLabel);
    }

    if (tagContext.biggestContributorId === affiliateId) {
      tags.push("Biggest Contributor");
    }

    if (tagContext.risingStarIds.has(affiliateId)) {
      tags.push("Rising Star");
    }

    if (Number.isFinite(tagContext.highEarnerThreshold) && paidEarnings >= tagContext.highEarnerThreshold && paidEarnings > 0) {
      tags.push("High Earner");
    }

    if (
      isRestricted ||
      tagContext.pendingWithdrawalIds.has(affiliateId) ||
      tagContext.clickWithoutConversionIds.has(affiliateId)
    ) {
      tags.push("Needs Attention");
    }

    return tags.slice(0, 3);
  }

  private getDateRange(period: PeriodType, startDate?: string, endDate?: string): DateRange {
    const now = new Date();

    if (period === "today") {
      return {
        start: startOfDay(now),
        end: endOfDay(now),
      };
    }

    if (period === "yesterday") {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return {
        start: startOfDay(yesterday),
        end: endOfDay(yesterday),
      };
    }

    if (period === "this_week") {
      const start = new Date(now);
      const day = start.getDay();
      start.setDate(start.getDate() - day);
      return {
        start: startOfDay(start),
        end: endOfDay(now),
      };
    }

    if (period === "this_month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return {
        start: startOfDay(start),
        end: endOfDay(now),
      };
    }

    if (period === "last_month") {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return {
        start: startOfDay(start),
        end: endOfDay(end),
      };
    }

    if (period === "custom") {
      const parsedStart = parseDateInput(startDate, "start_date", this.requestId);
      const parsedEnd = parseDateInput(endDate, "end_date", this.requestId);
      const start = startOfDay(parsedStart);
      const end = endOfDay(parsedEnd);

      if (start.getTime() > end.getTime()) {
        throw createAffiliateMgmtError(
          AffiliateMgmtErrorCode.INVALID_DATE_RANGE,
          "start_date must be less than or equal to end_date",
          400,
          this.requestId,
          { start_date: startDate, end_date: endDate }
        );
      }

      return { start, end };
    }

    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.INVALID_DATE_RANGE,
      "Invalid period. Allowed: today, yesterday, this_week, this_month, last_month, custom",
      400,
      this.requestId,
      { period }
    );
  }

  private async getAggregateMetricsByAffiliateIds(
    affiliateIds: bigint[],
    range?: DateRange
  ): Promise<Map<string, AggregateMetrics>> {
    const metrics = new Map<string, AggregateMetrics>();

    if (affiliateIds.length === 0) {
      return metrics;
    }

    const referralWhere: Prisma.ReferralWhereInput = {
      affiliate_user_id: { in: affiliateIds },
      ...(range ? { referral_date: { gte: range.start, lte: range.end } } : {}),
    };

    const convertedWhere: Prisma.ReferralWhereInput = {
      affiliate_user_id: { in: affiliateIds },
      conversion_date: {
        not: null,
        ...(range ? { gte: range.start, lte: range.end } : {}),
      },
    };

    const commissionWhere: Prisma.CommissionWhereInput = {
      affiliate_user_id: { in: affiliateIds },
      status: { in: [...APPROVED_COMMISSION_STATUSES] },
      ...(range ? { created_at: { gte: range.start, lte: range.end } } : {}),
    };

    const [referralCounts, conversionCounts, earnings] = await Promise.all([
      prisma.referral.groupBy({
        by: ["affiliate_user_id"],
        where: referralWhere,
        _count: { _all: true },
      }),
      prisma.referral.groupBy({
        by: ["affiliate_user_id"],
        where: convertedWhere,
        _count: { _all: true },
      }),
      prisma.commission.groupBy({
        by: ["affiliate_user_id"],
        where: commissionWhere,
        _sum: { amount: true },
      }),
    ]);

    for (const affiliateId of affiliateIds) {
      metrics.set(affiliateId.toString(), {
        totalReferrals: 0,
        successfulReferrals: 0,
        totalEarnings: 0,
      });
    }

    for (const row of referralCounts) {
      const key = row.affiliate_user_id.toString();
      const current = metrics.get(key);
      if (!current) continue;
      current.totalReferrals = row._count._all;
    }

    for (const row of conversionCounts) {
      const key = row.affiliate_user_id.toString();
      const current = metrics.get(key);
      if (!current) continue;
      current.successfulReferrals = row._count._all;
    }

    for (const row of earnings) {
      const key = row.affiliate_user_id.toString();
      const current = metrics.get(key);
      if (!current) continue;
      current.totalEarnings = Number(row._sum.amount ?? 0);
    }

    return metrics;
  }

  private async ensureAffiliateExists(affiliateId: number) {
    const affiliate = await prisma.user.findFirst({
      where: {
        AND: [this.buildAffiliateBaseWhere(), { user_id: BigInt(affiliateId) }],
      },
      select: {
        user_id: true,
        first_name: true,
        last_name: true,
        email: true,
        affiliate_code: true,
        is_affiliate: true,
        commission_rate: true,
        affiliate_joined_at: true,
        is_affiliate_restricted: true,
        affiliate_restricted_until: true,
        affiliate_restriction_reason: true,
        affiliate_restricted_by: true,
        total_affiliate_earnings: true,
        total_successful_referrals: true,
        profile_url: true,
        created_at: true,
        affiliateSettings: {
          select: {
            commission_rate: true,
            created_at: true,
          },
        },
      },
    });

    if (!affiliate) {
      throw createAffiliateMgmtError(
        AffiliateMgmtErrorCode.AFFILIATE_NOT_FOUND,
        `Affiliate with ID ${affiliateId} not found`,
        404,
        this.requestId,
        { affiliateId }
      );
    }

    return affiliate;
  }

  async verifySuperAdmin(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { user_id: BigInt(userId) },
      select: { role: true },
    });

    if (!user || user.role !== "super_admin") {
      throw createAffiliateMgmtError(
        AffiliateMgmtErrorCode.SUPERADMIN_REQUIRED,
        "SuperAdmin access required for affiliate management",
        403,
        this.requestId,
        { userId, currentRole: user?.role ?? null }
      );
    }
  }

  async getAffiliateAnalytics(): Promise<AffiliateAnalytics> {
    const [
      totalReferrals,
      totalConversions,
      totalPayouts,
      pendingPayouts,
      paidAffiliates,
      avgCommissionRate,
    ] = await Promise.all([
      prisma.referral.count(),
      prisma.referral.count({ where: { conversion_date: { not: null } } }),
      prisma.withdrawal.aggregate({
        where: { status: { in: [...COMPLETED_WITHDRAWAL_STATUSES] } },
        _sum: { amount: true },
      }),
      prisma.commission.aggregate({
        where: { status: "pending" },
        _sum: { amount: true },
      }),
      prisma.user.count({
        where: {
          is_affiliate: true,
          total_affiliate_earnings: { gt: 0 },
        },
      }),
      prisma.user.aggregate({
        where: { is_affiliate: true },
        _avg: { commission_rate: true },
      }),
    ]);

    const conversionRate = totalReferrals === 0 ? 0 : (totalConversions / totalReferrals) * 100;
    const totalPaidouts = Number(totalPayouts._sum.amount ?? 0);
    const pending = Number(pendingPayouts._sum.amount ?? 0);
    const avgCommission = Number(avgCommissionRate._avg.commission_rate ?? 0);

    return {
      total_referral_count: totalReferrals,
      conversion_rate: round2(conversionRate),
      total_paidouts: round2(totalPaidouts),
      total_paid_affiliates: paidAffiliates,
      pending_payouts: round2(pending),
      average_commission_rate: round2(avgCommission),
    };
  }

  async getDashboardSummary(): Promise<AffiliateDashboardSummary> {
    const analytics = await this.getAffiliateAnalytics();
    const now = new Date();
    const activeAffiliates = await prisma.user.count({
      where: {
        AND: [
          this.buildAffiliateBaseWhere(),
          {
            OR: [{ is_affiliate_restricted: false }, { affiliate_restricted_until: { lt: now } }],
          },
        ],
      },
    });

    return {
      total_referral_count: analytics.total_referral_count,
      conversion_rate: analytics.conversion_rate,
      total_paidout: analytics.total_paidouts,
      total_paid: round2(analytics.total_paidouts + analytics.pending_payouts),
      pending_payout: analytics.pending_payouts,
      active_affiliates: activeAffiliates,
    };
  }

  async getAffiliates(filters: AffiliateListFilters): Promise<{
    affiliates: AffiliateListItem[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
      has_next: boolean;
      has_previous: boolean;
    };
  }> {
    const page = Math.max(1, filters.page);
    const limit = Math.max(1, Math.min(filters.limit, 100));
    const skip = (page - 1) * limit;
    const now = new Date();

    const andClauses: Prisma.UserWhereInput[] = [this.buildAffiliateBaseWhere()];

    const statusWhere = this.buildStatusWhere(filters.status ?? "all", now);
    if (statusWhere) andClauses.push(statusWhere);

    const search = normalizeText(filters.search);
    if (search) {
      andClauses.push({
        OR: [
          { first_name: { contains: search } },
          { last_name: { contains: search } },
          { email: { contains: search } },
          { affiliate_code: { contains: search } },
          { serial_id: { contains: search } },
        ],
      });
    }

    const where: Prisma.UserWhereInput = { AND: andClauses };

    const [total, affiliates, tagContext] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: this.toAffiliateOrderBy(filters.sort_by, filters.sort_dir),
        skip,
        take: limit,
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
          email: true,
          serial_id: true,
          affiliate_code: true,
          commission_rate: true,
          affiliate_joined_at: true,
          is_affiliate_restricted: true,
          affiliate_restricted_until: true,
          total_affiliate_earnings: true,
          total_successful_referrals: true,
          profile_url: true,
          created_at: true,
          affiliateSettings: {
            select: {
              commission_rate: true,
              created_at: true,
            },
          },
        },
      }),
      this.buildAffiliateTagContext(),
    ]);

    const range = filters.period ? this.getDateRange(filters.period, filters.start_date, filters.end_date) : undefined;
    const affiliateIds = affiliates.map((affiliate) => affiliate.user_id);
    const [metricsMap, enrichment, paidByAffiliate] = await Promise.all([
      this.getAggregateMetricsByAffiliateIds(affiliateIds, range),
      this.resolveAffiliateEnrichment(affiliateIds),
      affiliateIds.length > 0
        ? prisma.shopCommission.groupBy({
            by: ["affiliate_user_id"],
            where: { affiliate_user_id: { in: affiliateIds }, status: "paid" },
            _sum: { commission_amount: true },
          })
        : Promise.resolve([]),
    ]);

    const paidMap = new Map(
      paidByAffiliate.map((row) => [row.affiliate_user_id.toString(), Number(row._sum.commission_amount ?? 0)])
    );

    const rows: AffiliateListItem[] = affiliates.map((affiliate) => {
      const key = affiliate.user_id.toString();
      const metrics = metricsMap.get(key);
      const totalReferrals = metrics?.totalReferrals ?? 0;
      const successfulReferrals =
        metrics?.successfulReferrals ?? Number(affiliate.total_successful_referrals ?? 0);
      const conversionRate = totalReferrals === 0 ? 0 : (successfulReferrals / totalReferrals) * 100;
      const totalEarnings = metrics?.totalEarnings ?? Number(affiliate.total_affiliate_earnings ?? 0);
      const commissionRate = Number(
        affiliate.commission_rate ?? affiliate.affiliateSettings?.commission_rate ?? DEFAULT_COMMISSION_RATE
      );
      const joinedAt =
        affiliate.affiliate_joined_at ?? affiliate.affiliateSettings?.created_at ?? affiliate.created_at;
      const isRestricted = isAffiliateRestrictedNow(
        affiliate.is_affiliate_restricted,
        affiliate.affiliate_restricted_until
      );

      return {
        affiliate_id: Number(affiliate.user_id),
        name: `${affiliate.first_name} ${affiliate.last_name}`.trim(),
        email: affiliate.email,
        affiliate_code: affiliate.affiliate_code,
        commission_rate: round2(commissionRate),
        joined_at: joinedAt,
        total_referrals: totalReferrals,
        successful_referrals: successfulReferrals,
        conversion_rate: round2(conversionRate),
        total_earnings: round2(totalEarnings),
        status: (isRestricted ? "restricted" : "active") as "restricted" | "active",
        restricted_until: affiliate.affiliate_restricted_until,
        profile_image: enrichment.profileImageByUser.get(key) ?? affiliate.profile_url ?? undefined,
        serial_id: enrichment.serialByUser.get(key) ?? affiliate.serial_id ?? null,
        subscription: enrichment.subscriptionByUser.get(key) ?? "free",
        portfolio_url: enrichment.portfolioByUser.get(key) ?? null,
        tags: this.resolveAffiliateTags({
          affiliateId: key,
          isRestricted,
          paidEarnings: paidMap.get(key) ?? 0,
          tagContext,
        }),
      };
    });

    if ((filters.sort_by ?? "joined_at") === "conversion_rate") {
      const direction = filters.sort_dir ?? "desc";
      rows.sort((a, b) =>
        direction === "asc" ? a.conversion_rate - b.conversion_rate : b.conversion_rate - a.conversion_rate
      );
    }

    const pages = Math.max(1, Math.ceil(total / limit));

    return {
      affiliates: rows,
      pagination: {
        page,
        limit,
        total,
        pages,
        has_next: page < pages,
        has_previous: page > 1,
      },
    };
  }

  async getTopPerformingAffiliates(limit = 10): Promise<{
    top_performers: TopPerformingAffiliate[];
    summary: {
      total_affiliates: number;
      average_conversion_rate: number;
      top_earner_name: string | null;
      top_earner_amount: number;
    };
  }> {
    const boundedLimit = Math.max(1, Math.min(limit, 50));
    const now = new Date();

    const where: Prisma.UserWhereInput = {
      AND: [
        this.buildAffiliateBaseWhere(),
        {
          OR: [{ is_affiliate_restricted: false }, { affiliate_restricted_until: { lt: now } }],
        },
      ],
    };

    const [totalAffiliates, affiliates] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: [{ total_affiliate_earnings: "desc" }, { total_successful_referrals: "desc" }],
        take: boundedLimit,
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
          email: true,
          commission_rate: true,
          total_affiliate_earnings: true,
          total_successful_referrals: true,
          profile_url: true,
          affiliateSettings: {
            select: {
              commission_rate: true,
            },
          },
        },
      }),
    ]);

    const affiliateIds = affiliates.map((affiliate) => affiliate.user_id);
    const [metricsMap, enrichment] = await Promise.all([
      this.getAggregateMetricsByAffiliateIds(affiliateIds),
      this.resolveAffiliateEnrichment(affiliateIds),
    ]);

    const topPerformers = affiliates.map((affiliate, index) => {
      const key = affiliate.user_id.toString();
      const metrics = metricsMap.get(key);
      const totalReferrals = metrics?.totalReferrals ?? 0;
      const successfulReferrals =
        metrics?.successfulReferrals ?? Number(affiliate.total_successful_referrals ?? 0);
      const conversionRate = totalReferrals === 0 ? 0 : (successfulReferrals / totalReferrals) * 100;
      const totalEarnings = metrics?.totalEarnings ?? Number(affiliate.total_affiliate_earnings ?? 0);
      const commissionRate = Number(
        affiliate.commission_rate ?? affiliate.affiliateSettings?.commission_rate ?? DEFAULT_COMMISSION_RATE
      );

      return {
        affiliate_id: Number(affiliate.user_id),
        name: `${affiliate.first_name} ${affiliate.last_name}`.trim(),
        email: affiliate.email,
        commission_rate: round2(commissionRate),
        total_referrals: totalReferrals,
        total_earnings: round2(totalEarnings),
        conversion_rate: round2(conversionRate),
        profile_image: enrichment.profileImageByUser.get(key) ?? affiliate.profile_url ?? undefined,
        rank: index + 1,
      };
    });

    const averageConversionRate =
      topPerformers.length === 0
        ? 0
        : topPerformers.reduce((sum, item) => sum + item.conversion_rate, 0) / topPerformers.length;

    return {
      top_performers: topPerformers,
      summary: {
        total_affiliates: totalAffiliates,
        average_conversion_rate: round2(averageConversionRate),
        top_earner_name: topPerformers[0]?.name ?? null,
        top_earner_amount: topPerformers[0]?.total_earnings ?? 0,
      },
    };
  }

  async getRecentReferrals(limit = 20): Promise<{
    recent_referrals: RecentReferral[];
    total_referrals_last_24h: number;
    total_conversions_last_24h: number;
  }> {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const affiliateIdentity = {
      OR: [
        { is_affiliate: true },
        { affiliateSettings: { isNot: null } },
        { affiliate_code: { not: null } },
        { affiliates: { some: {} } },
      ],
    };

    const referrals = await prisma.referral.findMany({
      where: {
        affiliateUser: {
          AND: [{ role: "user" }, affiliateIdentity],
        },
      },
      orderBy: { referral_date: "desc" },
      take: boundedLimit,
      select: {
        id: true,
        affiliate_user_id: true,
        referred_user_id: true,
        referral_date: true,
        conversion_date: true,
        lifetime_value: true,
        affiliateUser: {
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            email: true,
          },
        },
        referredUser: {
          select: {
            first_name: true,
            last_name: true,
            email: true,
          },
        },
      },
    });

    const affiliateIds = Array.from(new Set(referrals.map((ref) => ref.affiliate_user_id)));
    const referredIds = Array.from(new Set(referrals.map((ref) => ref.referred_user_id)));

    const commissionRows =
      referrals.length === 0
        ? []
        : await prisma.commission.groupBy({
            by: ["affiliate_user_id", "referred_user_id"],
            where: {
              affiliate_user_id: { in: affiliateIds },
              referred_user_id: { in: referredIds },
              status: { in: [...APPROVED_COMMISSION_STATUSES] },
            },
            _sum: { amount: true },
          });

    const commissionMap = new Map<string, number>();
    for (const row of commissionRows) {
      commissionMap.set(
        `${row.affiliate_user_id.toString()}:${row.referred_user_id.toString()}`,
        Number(row._sum.amount ?? 0)
      );
    }

    const recentReferrals = referrals.map((referral) => {
      const key = `${referral.affiliate_user_id.toString()}:${referral.referred_user_id.toString()}`;
      return {
        referral_id: Number(referral.id),
        affiliate_id: Number(referral.affiliateUser.user_id),
        affiliate_name: `${referral.affiliateUser.first_name} ${referral.affiliateUser.last_name}`.trim(),
        referred_user_name: `${referral.referredUser.first_name} ${referral.referredUser.last_name}`.trim(),
        referred_user_email: referral.referredUser.email,
        converted: referral.conversion_date !== null,
        order_amount: Number(referral.lifetime_value ?? 0),
        commission_earned: round2(commissionMap.get(key) ?? 0),
        referred_at: referral.referral_date,
        converted_at: referral.conversion_date,
      };
    });

    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [totalReferralsLast24h, totalConversionsLast24h] = await Promise.all([
      prisma.referral.count({
        where: {
          referral_date: { gte: last24h },
          affiliateUser: {
            AND: [{ role: "user" }, affiliateIdentity],
          },
        },
      }),
      prisma.referral.count({
        where: {
          conversion_date: { not: null, gte: last24h },
          affiliateUser: {
            AND: [{ role: "user" }, affiliateIdentity],
          },
        },
      }),
    ]);

    return {
      recent_referrals: recentReferrals,
      total_referrals_last_24h: totalReferralsLast24h,
      total_conversions_last_24h: totalConversionsLast24h,
    };
  }

  async getAffiliateDetails(
    affiliateId: number,
    range: AffiliateDetailRange = "last_6_months"
  ): Promise<{
    profile: {
      affiliate_id: number;
      first_name: string;
      last_name: string;
      name: string;
      email: string;
      serial_id: string | null;
      subscription: string;
      profile_image: string | null;
      portfolio_url: string | null;
      affiliate_code: string;
      commission_rate: number;
      date_started: Date;
      is_restricted: boolean;
      restricted_until: Date | null;
      restriction_reason: string | null;
    };
    tags: string[];
    stats: {
      total_referrals: number;
      successful_referrals: number;
      total_orders: number;
      total_commission: number;
      paid_commissions: number;
      pending_commissions: number;
      conversion_rate: number;
      withdrawal_total: number;
      pending_withdrawals: number;
    };
    referral_orders: Array<{
      commission_id: string;
      order_id: string;
      order_number: string;
      date: string;
      status: string;
      order_total: number;
      commission_amount: number;
      commission_status: string;
      commission_rate: number;
      referred_user: string;
      referred_email: string;
      items_summary: string;
      payment_method: string | null;
    }>;
    order_chart: Array<{ period: string; label: string; order_count: number; revenue: number }>;
    commissions: Array<{
      commission_id: string;
      order_number: string | null;
      amount: number;
      status: string;
      created_at: string;
      paid_at: string | null;
    }>;
    withdrawals: Array<{
      id: string;
      amount: number;
      status: string;
      payment_method: string | null;
      reference_number: string | null;
      requested_at: string;
      processed_at: string | null;
    }>;
    range: AffiliateDetailRange;
    // Backward-compatible flat fields
    affiliate_id: number;
    first_name: string;
    last_name: string;
    email: string;
    affiliate_code: string;
    commission_rate: number;
    date_started: Date;
    is_restricted: boolean;
    restricted_until: Date | null;
    restriction_reason: string | null;
    total_referrals: number;
    successful_referrals: number;
    total_commissions: number;
    paid_commissions: number;
    pending_commissions: number;
    conversion_rate: number;
    recent_referrals: Array<{
      referred_user: string;
      referred_email: string;
      converted: boolean;
      order_amount: number;
      commission: number;
      referred_at: Date;
    }>;
    monthly_earnings: Array<{ month: string; amount: number }>;
  }> {
    const affiliate = await prisma.user.findFirst({
      where: {
        AND: [this.buildAffiliateBaseWhere(), { user_id: BigInt(affiliateId) }],
      },
      select: {
        user_id: true,
        first_name: true,
        last_name: true,
        email: true,
        serial_id: true,
        profile_url: true,
        affiliate_code: true,
        commission_rate: true,
        affiliate_joined_at: true,
        is_affiliate_restricted: true,
        affiliate_restricted_until: true,
        affiliate_restriction_reason: true,
        total_affiliate_earnings: true,
        total_successful_referrals: true,
        created_at: true,
        affiliateSettings: {
          select: {
            commission_rate: true,
            created_at: true,
          },
        },
        referralsAsAffiliate: {
          orderBy: { referral_date: "desc" },
          take: 20,
          select: {
            referred_user_id: true,
            referral_date: true,
            conversion_date: true,
            lifetime_value: true,
            referredUser: {
              select: {
                first_name: true,
                last_name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!affiliate) {
      throw createAffiliateMgmtError(
        AffiliateMgmtErrorCode.AFFILIATE_NOT_FOUND,
        `Affiliate with ID ${affiliateId} not found`,
        404,
        this.requestId,
        { affiliateId }
      );
    }

    const dateRange = this.getDetailDateRange(range);
    const affiliateKey = affiliate.user_id.toString();

    const [
      totalReferrals,
      successfulReferrals,
      shopCommissionAgg,
      paidShopCommissions,
      pendingShopCommissions,
      withdrawalAgg,
      pendingWithdrawalAgg,
      shopCommissions,
      chartCommissions,
      withdrawals,
      enrichment,
      tagContext,
      paidForTags,
    ] = await Promise.all([
      prisma.referral.count({ where: { affiliate_user_id: affiliate.user_id } }),
      prisma.referral.count({
        where: {
          affiliate_user_id: affiliate.user_id,
          conversion_date: { not: null },
        },
      }),
      prisma.shopCommission.aggregate({
        where: {
          affiliate_user_id: affiliate.user_id,
          status: { not: "voided" },
        },
        _sum: { commission_amount: true },
        _count: { _all: true },
      }),
      prisma.shopCommission.aggregate({
        where: { affiliate_user_id: affiliate.user_id, status: "paid" },
        _sum: { commission_amount: true },
      }),
      prisma.shopCommission.aggregate({
        where: { affiliate_user_id: affiliate.user_id, status: { in: ["pending", "approved"] } },
        _sum: { commission_amount: true },
      }),
      prisma.withdrawal.aggregate({
        where: {
          affiliate_user_id: affiliate.user_id,
          status: { in: [...COMPLETED_WITHDRAWAL_STATUSES] },
        },
        _sum: { amount: true },
      }),
      prisma.withdrawal.aggregate({
        where: {
          affiliate_user_id: affiliate.user_id,
          status: { in: ["requested", "pending", "processing"] },
        },
        _sum: { amount: true },
      }),
      prisma.shopCommission.findMany({
        where: {
          affiliate_user_id: affiliate.user_id,
          created_at: { gte: dateRange.start, lte: dateRange.end },
        },
        orderBy: { created_at: "desc" },
        take: 100,
        select: {
          shop_commission_id: true,
          commission_amount: true,
          commission_rate: true,
          status: true,
          created_at: true,
          processed_at: true,
          referredUser: {
            select: { first_name: true, last_name: true, email: true },
          },
          shopOrder: {
            select: {
              id: true,
              order_number: true,
              status: true,
              total_amount: true,
              payment_method: true,
              placed_at: true,
              completed_at: true,
              cancelled_at: true,
              items: {
                select: { item_name: true, quantity: true },
                take: 5,
              },
            },
          },
        },
      }),
      prisma.shopCommission.findMany({
        where: {
          affiliate_user_id: affiliate.user_id,
          created_at: { gte: dateRange.start, lte: dateRange.end },
          status: { not: "voided" },
        },
        select: {
          commission_amount: true,
          created_at: true,
          shopOrder: { select: { total_amount: true } },
        },
      }),
      prisma.withdrawal.findMany({
        where: { affiliate_user_id: affiliate.user_id },
        orderBy: { requested_at: "desc" },
        take: 50,
        select: {
          id: true,
          amount: true,
          status: true,
          payment_method: true,
          reference_number: true,
          requested_at: true,
          processed_at: true,
        },
      }),
      this.resolveAffiliateEnrichment([affiliate.user_id]),
      this.buildAffiliateTagContext(),
      prisma.shopCommission.aggregate({
        where: { affiliate_user_id: affiliate.user_id, status: "paid" },
        _sum: { commission_amount: true },
      }),
    ]);

    const conversionRate = totalReferrals === 0 ? 0 : (successfulReferrals / totalReferrals) * 100;
    const totalCommissions = round2(
      Number(shopCommissionAgg._sum.commission_amount ?? affiliate.total_affiliate_earnings ?? 0)
    );
    const paid = round2(Number(paidShopCommissions._sum.commission_amount ?? 0));
    const pending = round2(Number(pendingShopCommissions._sum.commission_amount ?? 0));
    const isRestricted = isAffiliateRestrictedNow(
      affiliate.is_affiliate_restricted,
      affiliate.affiliate_restricted_until
    );
    const commissionRate = round2(
      Number(affiliate.commission_rate ?? affiliate.affiliateSettings?.commission_rate ?? DEFAULT_COMMISSION_RATE)
    );
    const dateStarted =
      affiliate.affiliate_joined_at ?? affiliate.affiliateSettings?.created_at ?? affiliate.created_at;

    const monthBuckets = this.buildMonthBuckets(dateRange);
    const chartMap = new Map(monthBuckets.map((period) => [period, { order_count: 0, revenue: 0 }]));
    for (const row of chartCommissions) {
      const year = row.created_at.getFullYear();
      const month = String(row.created_at.getMonth() + 1).padStart(2, "0");
      const key = `${year}-${month}`;
      const bucket = chartMap.get(key);
      if (!bucket) continue;
      bucket.order_count += 1;
      bucket.revenue += Number(row.shopOrder?.total_amount ?? 0);
    }
    const orderChart = monthBuckets.map((period) => {
      const [year, month] = period.split("-");
      const monthIndex = Number(month) - 1;
      const bucket = chartMap.get(period) ?? { order_count: 0, revenue: 0 };
      return {
        period,
        label: `${MONTH_NAMES[monthIndex]?.slice(0, 3) ?? month} ${year}`,
        order_count: bucket.order_count,
        revenue: round2(bucket.revenue),
      };
    });

    const referralOrders = shopCommissions.map((row) => {
      const items = row.shopOrder.items
        .map((item) => `${item.item_name}${item.quantity > 1 ? ` x${item.quantity}` : ""}`)
        .join(", ");
      return {
        commission_id: row.shop_commission_id.toString(),
        order_id: row.shopOrder.id.toString(),
        order_number: row.shopOrder.order_number,
        date: (row.shopOrder.placed_at ?? row.created_at).toISOString(),
        status: row.shopOrder.status,
        order_total: round2(Number(row.shopOrder.total_amount ?? 0)),
        commission_amount: round2(Number(row.commission_amount ?? 0)),
        commission_status: row.status,
        commission_rate: round2(Number(row.commission_rate ?? commissionRate)),
        referred_user: `${row.referredUser.first_name} ${row.referredUser.last_name}`.trim(),
        referred_email: row.referredUser.email,
        items_summary: items || "—",
        payment_method: row.shopOrder.payment_method,
      };
    });

    const commissions = shopCommissions.map((row) => ({
      commission_id: row.shop_commission_id.toString(),
      order_number: row.shopOrder.order_number,
      amount: round2(Number(row.commission_amount ?? 0)),
      status: row.status,
      created_at: row.created_at.toISOString(),
      paid_at: row.processed_at?.toISOString() ?? null,
    }));

    const withdrawalRows = withdrawals.map((row) => ({
      id: row.id.toString(),
      amount: round2(Number(row.amount ?? 0)),
      status: row.status,
      payment_method: row.payment_method,
      reference_number: row.reference_number,
      requested_at: row.requested_at.toISOString(),
      processed_at: row.processed_at?.toISOString() ?? null,
    }));

    const tags = this.resolveAffiliateTags({
      affiliateId: affiliateKey,
      isRestricted,
      paidEarnings: Number(paidForTags._sum.commission_amount ?? 0),
      tagContext,
    });

    const commissionByReferredUser = new Map<string, number>();
    const recentReferralUserIds = affiliate.referralsAsAffiliate.map((referral) => referral.referred_user_id);
    if (recentReferralUserIds.length > 0) {
      const legacyCommissions = await prisma.commission.groupBy({
        by: ["referred_user_id"],
        where: {
          affiliate_user_id: affiliate.user_id,
          referred_user_id: { in: recentReferralUserIds },
          status: { in: [...APPROVED_COMMISSION_STATUSES] },
        },
        _sum: { amount: true },
      });
      for (const commission of legacyCommissions) {
        commissionByReferredUser.set(
          commission.referred_user_id.toString(),
          Number(commission._sum.amount ?? 0)
        );
      }
    }

    const recentReferrals = affiliate.referralsAsAffiliate.map((referral) => ({
      referred_user: `${referral.referredUser.first_name} ${referral.referredUser.last_name}`.trim(),
      referred_email: referral.referredUser.email,
      converted: referral.conversion_date !== null,
      order_amount: round2(Number(referral.lifetime_value ?? 0)),
      commission: round2(commissionByReferredUser.get(referral.referred_user_id.toString()) ?? 0),
      referred_at: referral.referral_date,
    }));

    const monthlyEarnings = orderChart.map((point) => ({
      month: point.period,
      amount: point.revenue,
    }));

    const profile = {
      affiliate_id: Number(affiliate.user_id),
      first_name: affiliate.first_name,
      last_name: affiliate.last_name,
      name: `${affiliate.first_name} ${affiliate.last_name}`.trim(),
      email: affiliate.email,
      serial_id: enrichment.serialByUser.get(affiliateKey) ?? affiliate.serial_id ?? null,
      subscription: enrichment.subscriptionByUser.get(affiliateKey) ?? "free",
      profile_image: enrichment.profileImageByUser.get(affiliateKey) ?? affiliate.profile_url,
      portfolio_url: enrichment.portfolioByUser.get(affiliateKey) ?? null,
      affiliate_code: affiliate.affiliate_code ?? "N/A",
      commission_rate: commissionRate,
      date_started: dateStarted,
      is_restricted: isRestricted,
      restricted_until: affiliate.affiliate_restricted_until,
      restriction_reason: affiliate.affiliate_restriction_reason,
    };

    return {
      profile,
      tags,
      stats: {
        total_referrals: totalReferrals,
        successful_referrals: successfulReferrals,
        total_orders: shopCommissionAgg._count._all,
        total_commission: totalCommissions,
        paid_commissions: paid,
        pending_commissions: pending,
        conversion_rate: round2(conversionRate),
        withdrawal_total: round2(Number(withdrawalAgg._sum.amount ?? 0)),
        pending_withdrawals: round2(Number(pendingWithdrawalAgg._sum.amount ?? 0)),
      },
      referral_orders: referralOrders,
      order_chart: orderChart,
      commissions,
      withdrawals: withdrawalRows,
      range,
      affiliate_id: profile.affiliate_id,
      first_name: profile.first_name,
      last_name: profile.last_name,
      email: profile.email,
      affiliate_code: profile.affiliate_code,
      commission_rate: profile.commission_rate,
      date_started: profile.date_started,
      is_restricted: profile.is_restricted,
      restricted_until: profile.restricted_until,
      restriction_reason: profile.restriction_reason,
      total_referrals: totalReferrals,
      successful_referrals: successfulReferrals,
      total_commissions: totalCommissions,
      paid_commissions: paid,
      pending_commissions: pending,
      conversion_rate: round2(conversionRate),
      recent_referrals: recentReferrals,
      monthly_earnings: monthlyEarnings,
    };
  }

  private async getAffiliateMonthlyEarnings(affiliateUserId: bigint): Promise<Array<{ month: string; amount: number }>> {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const earnings = await prisma.commission.findMany({
      where: {
        affiliate_user_id: affiliateUserId,
        status: { in: [...APPROVED_COMMISSION_STATUSES] },
        created_at: { gte: startOfDay(sixMonthsAgo) },
      },
      select: {
        amount: true,
        created_at: true,
      },
      orderBy: { created_at: "asc" },
    });

    const monthlyMap = new Map<string, number>();
    for (const earning of earnings) {
      const year = earning.created_at.getFullYear();
      const month = String(earning.created_at.getMonth() + 1).padStart(2, "0");
      const key = `${year}-${month}`;
      const current = monthlyMap.get(key) ?? 0;
      monthlyMap.set(key, current + Number(earning.amount ?? 0));
    }

    return Array.from(monthlyMap.entries()).map(([month, amount]) => ({
      month,
      amount: round2(amount),
    }));
  }

  async updateAffiliateCommissionRate(
    affiliateId: number,
    commissionRate: number,
    performedBy: string,
    context?: AffiliateActorContext
  ): Promise<{
    affiliate_id: number;
    commission_rate: number;
    message: string;
  }> {
    if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100) {
      throw createAffiliateMgmtError(
        AffiliateMgmtErrorCode.INVALID_COMMISSION_RATE,
        "Commission rate must be between 0 and 100",
        400,
        this.requestId,
        { commissionRate, min: 0, max: 100 }
      );
    }

    const affiliate = await this.ensureAffiliateExists(affiliateId);
    const oldRate = Number(affiliate.commission_rate ?? affiliate.affiliateSettings?.commission_rate ?? DEFAULT_COMMISSION_RATE);
    const normalizedRate = round2(commissionRate);

    const updated = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { user_id: affiliate.user_id },
        data: {
          is_affiliate: true,
          commission_rate: normalizedRate,
          affiliate_joined_at: affiliate.affiliate_joined_at ?? new Date(),
        },
        select: {
          user_id: true,
          commission_rate: true,
        },
      });

      await tx.affiliateSettings.upsert({
        where: { user_id: affiliate.user_id },
        create: {
          user_id: affiliate.user_id,
          commission_rate: normalizedRate,
        },
        update: {
          commission_rate: normalizedRate,
          updated_at: new Date(),
        },
      });

      await tx.affiliateAuditLog.create({
        data: {
          affiliate_user_id: affiliate.user_id,
          action: "update_commission_rate",
          performed_by: BigInt(performedBy),
          old_values: toJsonString({ commission_rate: oldRate }),
          new_values: toJsonString({ commission_rate: normalizedRate }),
          ip_address: context?.ipAddress ?? null,
          user_agent: context?.userAgent ?? null,
          request_id: this.requestId,
        },
      });

      return updatedUser;
    });

    return {
      affiliate_id: Number(updated.user_id),
      commission_rate: round2(Number(updated.commission_rate ?? normalizedRate)),
      message: `Commission rate updated from ${round2(oldRate)}% to ${round2(normalizedRate)}%`,
    };
  }

  async updateAffiliate(
    affiliateId: number,
    updates: {
      first_name?: string;
      last_name?: string;
      email?: string;
      commission_rate?: number;
    },
    performedBy: string,
    context?: AffiliateActorContext
  ): Promise<{
    affiliate_id: number;
    name: string;
    email: string;
    commission_rate: number;
    message: string;
  }> {
    const affiliate = await this.ensureAffiliateExists(affiliateId);

    if (
      updates.commission_rate !== undefined &&
      (!Number.isFinite(updates.commission_rate) || updates.commission_rate < 0 || updates.commission_rate > 100)
    ) {
      throw createAffiliateMgmtError(
        AffiliateMgmtErrorCode.INVALID_COMMISSION_RATE,
        "Commission rate must be between 0 and 100",
        400,
        this.requestId,
        { commissionRate: updates.commission_rate, min: 0, max: 100 }
      );
    }

    if (updates.email) {
      const existingUser = await prisma.user.findFirst({
        where: {
          email: updates.email,
          user_id: { not: BigInt(affiliateId) },
        },
        select: { user_id: true },
      });

      if (existingUser) {
        throw createAffiliateMgmtError(
          AffiliateMgmtErrorCode.INVALID_AFFILIATE_DATA,
          `Email ${updates.email} is already in use`,
          409,
          this.requestId,
          { email: updates.email }
        );
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updateData: Prisma.UserUpdateInput = {
        is_affiliate: true,
      };

      if (updates.first_name !== undefined) updateData.first_name = updates.first_name.trim();
      if (updates.last_name !== undefined) updateData.last_name = updates.last_name.trim();
      if (updates.email !== undefined) updateData.email = updates.email.trim().toLowerCase();

      if (updates.commission_rate !== undefined) {
        const normalizedRate = round2(updates.commission_rate);
        updateData.commission_rate = normalizedRate;

        await tx.affiliateSettings.upsert({
          where: { user_id: affiliate.user_id },
          create: {
            user_id: affiliate.user_id,
            commission_rate: normalizedRate,
          },
          update: {
            commission_rate: normalizedRate,
            updated_at: new Date(),
          },
        });
      }

      const user = await tx.user.update({
        where: { user_id: affiliate.user_id },
        data: updateData,
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
          email: true,
          commission_rate: true,
        },
      });

      await tx.affiliateAuditLog.create({
        data: {
          affiliate_user_id: affiliate.user_id,
          action: "update_affiliate",
          performed_by: BigInt(performedBy),
          old_values: toJsonString({
            first_name: affiliate.first_name,
            last_name: affiliate.last_name,
            email: affiliate.email,
            commission_rate: Number(affiliate.commission_rate),
          }),
          new_values: toJsonString({
            first_name: user.first_name,
            last_name: user.last_name,
            email: user.email,
            commission_rate: Number(user.commission_rate ?? affiliate.commission_rate),
          }),
          ip_address: context?.ipAddress ?? null,
          user_agent: context?.userAgent ?? null,
          request_id: this.requestId,
        },
      });

      return user;
    });

    return {
      affiliate_id: Number(updated.user_id),
      name: `${updated.first_name} ${updated.last_name}`.trim(),
      email: updated.email,
      commission_rate: round2(Number(updated.commission_rate ?? affiliate.commission_rate ?? DEFAULT_COMMISSION_RATE)),
      message: "Affiliate information updated successfully",
    };
  }

  async restrictAffiliate(
    affiliateId: number,
    durationDays: number,
    reason: string,
    performedBy: string,
    context?: AffiliateActorContext
  ): Promise<{
    affiliate_id: number;
    name: string;
    is_restricted: boolean;
    restricted_until: Date;
    restriction_reason: string;
    message: string;
  }> {
    if (!Number.isInteger(durationDays) || durationDays <= 0 || durationDays > 365) {
      throw createAffiliateMgmtError(
        AffiliateMgmtErrorCode.INVALID_DATE_RANGE,
        "Restriction duration must be between 1 and 365 days",
        400,
        this.requestId,
        { durationDays, min: 1, max: 365 }
      );
    }

    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      throw createAffiliateMgmtError(
        AffiliateMgmtErrorCode.INVALID_AFFILIATE_DATA,
        "Restriction reason is required",
        400,
        this.requestId
      );
    }

    if (normalizedReason.length > 500) {
      throw createAffiliateMgmtError(
        AffiliateMgmtErrorCode.INVALID_AFFILIATE_DATA,
        "Restriction reason must be at most 500 characters",
        400,
        this.requestId,
        { reasonLength: normalizedReason.length }
      );
    }

    const affiliate = await this.ensureAffiliateExists(affiliateId);
    if (isAffiliateRestrictedNow(affiliate.is_affiliate_restricted, affiliate.affiliate_restricted_until)) {
      throw createAffiliateMgmtError(
        AffiliateMgmtErrorCode.AFFILIATE_ALREADY_RESTRICTED,
        "Affiliate is already restricted",
        409,
        this.requestId,
        { affiliateId, restrictedUntil: affiliate.affiliate_restricted_until }
      );
    }

    const restrictedUntil = new Date();
    restrictedUntil.setDate(restrictedUntil.getDate() + durationDays);

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { user_id: affiliate.user_id },
        data: {
          is_affiliate: true,
          is_affiliate_restricted: true,
          affiliate_restricted_until: restrictedUntil,
          affiliate_restriction_reason: normalizedReason,
          affiliate_restricted_by: BigInt(performedBy),
          affiliate_restricted_at: new Date(),
        },
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
        },
      });

      await tx.affiliateAuditLog.create({
        data: {
          affiliate_user_id: affiliate.user_id,
          action: "restrict",
          performed_by: BigInt(performedBy),
          old_values: toJsonString({
            is_restricted: affiliate.is_affiliate_restricted,
            restricted_until: affiliate.affiliate_restricted_until,
            restriction_reason: affiliate.affiliate_restriction_reason,
          }),
          new_values: toJsonString({
            is_restricted: true,
            restricted_until: restrictedUntil,
            restriction_reason: normalizedReason,
          }),
          ip_address: context?.ipAddress ?? null,
          user_agent: context?.userAgent ?? null,
          request_id: this.requestId,
        },
      });

      return user;
    });

    return {
      affiliate_id: Number(updated.user_id),
      name: `${updated.first_name} ${updated.last_name}`.trim(),
      is_restricted: true,
      restricted_until: restrictedUntil,
      restriction_reason: normalizedReason,
      message: `Affiliate has been restricted for ${durationDays} day(s)`,
    };
  }

  async unrestrictAffiliate(
    affiliateId: number,
    performedBy: string,
    context?: AffiliateActorContext
  ): Promise<{
    affiliate_id: number;
    name: string;
    is_restricted: boolean;
    message: string;
  }> {
    const affiliate = await this.ensureAffiliateExists(affiliateId);

    if (!isAffiliateRestrictedNow(affiliate.is_affiliate_restricted, affiliate.affiliate_restricted_until)) {
      throw createAffiliateMgmtError(
        AffiliateMgmtErrorCode.AFFILIATE_NOT_RESTRICTED,
        "Affiliate is not currently restricted",
        409,
        this.requestId,
        { affiliateId }
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { user_id: affiliate.user_id },
        data: {
          is_affiliate_restricted: false,
          affiliate_restricted_until: null,
          affiliate_restriction_reason: null,
          affiliate_restricted_by: null,
          affiliate_restricted_at: null,
        },
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
        },
      });

      await tx.affiliateAuditLog.create({
        data: {
          affiliate_user_id: affiliate.user_id,
          action: "unrestrict",
          performed_by: BigInt(performedBy),
          old_values: toJsonString({
            is_restricted: affiliate.is_affiliate_restricted,
            restricted_until: affiliate.affiliate_restricted_until,
            restriction_reason: affiliate.affiliate_restriction_reason,
          }),
          new_values: toJsonString({
            is_restricted: false,
            restricted_until: null,
            restriction_reason: null,
          }),
          ip_address: context?.ipAddress ?? null,
          user_agent: context?.userAgent ?? null,
          request_id: this.requestId,
        },
      });

      return user;
    });

    return {
      affiliate_id: Number(updated.user_id),
      name: `${updated.first_name} ${updated.last_name}`.trim(),
      is_restricted: false,
      message: "Affiliate restriction has been removed",
    };
  }

  async getAffiliatePerformance(
    affiliateId: number,
    period: PeriodType,
    startDate?: string,
    endDate?: string
  ): Promise<{
    period: {
      start: Date;
      end: Date;
    };
    metrics: {
      referrals: number;
      conversions: number;
      conversion_rate: number;
      commission_earned: number;
      payout_received: number;
    };
  }> {
    const range = this.getDateRange(period, startDate, endDate);
    const affiliate = await this.ensureAffiliateExists(affiliateId);

    const [referrals, conversions, commissions, payouts] = await Promise.all([
      prisma.referral.count({
        where: {
          affiliate_user_id: affiliate.user_id,
          referral_date: { gte: range.start, lte: range.end },
        },
      }),
      prisma.referral.count({
        where: {
          affiliate_user_id: affiliate.user_id,
          conversion_date: { not: null, gte: range.start, lte: range.end },
        },
      }),
      prisma.commission.aggregate({
        where: {
          affiliate_user_id: affiliate.user_id,
          created_at: { gte: range.start, lte: range.end },
          status: { in: [...APPROVED_COMMISSION_STATUSES] },
        },
        _sum: { amount: true },
      }),
      prisma.withdrawal.aggregate({
        where: {
          affiliate_user_id: affiliate.user_id,
          created_at: { gte: range.start, lte: range.end },
          status: { in: [...COMPLETED_WITHDRAWAL_STATUSES] },
        },
        _sum: { amount: true },
      }),
    ]);

    const conversionRate = referrals === 0 ? 0 : (conversions / referrals) * 100;
    const commissionEarned = Number(commissions._sum.amount ?? 0);
    const payoutReceived = Number(payouts._sum.amount ?? 0);

    const periodType =
      period === "today"
        ? "day"
        : period === "this_week"
          ? "week"
          : period === "this_month" || period === "last_month"
            ? "month"
            : null;

    if (periodType) {
      await prisma.affiliatePerformanceMetric.upsert({
        where: {
          affiliate_user_id_period_date_period_type: {
            affiliate_user_id: affiliate.user_id,
            period_date: startOfDay(range.start),
            period_type: periodType,
          },
        },
        create: {
          affiliate_user_id: affiliate.user_id,
          period_date: startOfDay(range.start),
          period_type: periodType,
          referrals_count: referrals,
          converted_referrals: conversions,
          conversion_rate: round2(conversionRate),
          commission_earned: round2(commissionEarned),
          payout_amount: round2(payoutReceived),
        },
        update: {
          referrals_count: referrals,
          converted_referrals: conversions,
          conversion_rate: round2(conversionRate),
          commission_earned: round2(commissionEarned),
          payout_amount: round2(payoutReceived),
          updated_at: new Date(),
        },
      });
    }

    return {
      period: {
        start: range.start,
        end: range.end,
      },
      metrics: {
        referrals,
        conversions,
        conversion_rate: round2(conversionRate),
        commission_earned: round2(commissionEarned),
        payout_received: round2(payoutReceived),
      },
    };
  }

  async exportAffiliates(filters: Omit<AffiliateListFilters, "page" | "limit">): Promise<Buffer> {
    try {
      const now = new Date();
      const andClauses: Prisma.UserWhereInput[] = [this.buildAffiliateBaseWhere()];

      const statusWhere = this.buildStatusWhere(filters.status ?? "all", now);
      if (statusWhere) andClauses.push(statusWhere);

      const search = normalizeText(filters.search);
      if (search) {
        andClauses.push({
          OR: [
            { first_name: { contains: search } },
            { last_name: { contains: search } },
            { email: { contains: search } },
            { affiliate_code: { contains: search } },
          ],
        });
      }

      const where: Prisma.UserWhereInput = { AND: andClauses };

      const total = await prisma.user.count({ where });
      if (total > MAX_EXPORT_ROWS) {
        throw createAffiliateMgmtError(
          AffiliateMgmtErrorCode.EXPORT_TOO_LARGE,
          `Export exceeds maximum row limit (${MAX_EXPORT_ROWS})`,
          413,
          this.requestId,
          { total, maxRows: MAX_EXPORT_ROWS }
        );
      }

      const affiliates = await prisma.user.findMany({
        where,
        orderBy: [{ affiliate_joined_at: "desc" }, { created_at: "desc" }],
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
          email: true,
          affiliate_code: true,
          commission_rate: true,
          affiliate_joined_at: true,
          is_affiliate_restricted: true,
          affiliate_restricted_until: true,
          total_affiliate_earnings: true,
          total_successful_referrals: true,
          created_at: true,
          affiliateSettings: {
            select: {
              commission_rate: true,
              created_at: true,
            },
          },
        },
      });

      const range = filters.period ? this.getDateRange(filters.period, filters.start_date, filters.end_date) : undefined;
      const affiliateIds = affiliates.map((affiliate) => affiliate.user_id);
      const metricsMap = await this.getAggregateMetricsByAffiliateIds(affiliateIds, range);

      const headers = [
        "Affiliate ID",
        "Name",
        "Email",
        "Affiliate Code",
        "Commission Rate",
        "Joined Date",
        "Total Referrals",
        "Successful Referrals",
        "Conversion Rate",
        "Total Earnings",
        "Status",
        "Restricted Until",
      ];

      const rows = affiliates.map((affiliate) => {
        const metrics = metricsMap.get(affiliate.user_id.toString());
        const totalReferrals = metrics?.totalReferrals ?? 0;
        const successfulReferrals =
          metrics?.successfulReferrals ?? Number(affiliate.total_successful_referrals ?? 0);
        const conversionRate = totalReferrals === 0 ? 0 : (successfulReferrals / totalReferrals) * 100;
        const totalEarnings = metrics?.totalEarnings ?? Number(affiliate.total_affiliate_earnings ?? 0);

        const joinedDate =
          affiliate.affiliate_joined_at ?? affiliate.affiliateSettings?.created_at ?? affiliate.created_at;

        return [
          Number(affiliate.user_id),
          `${affiliate.first_name} ${affiliate.last_name}`.trim(),
          affiliate.email,
          affiliate.affiliate_code ?? "N/A",
          `${round2(Number(affiliate.commission_rate ?? affiliate.affiliateSettings?.commission_rate ?? DEFAULT_COMMISSION_RATE))}%`,
          toIsoDateKey(joinedDate),
          totalReferrals,
          successfulReferrals,
          `${round2(conversionRate)}%`,
          round2(totalEarnings).toFixed(2),
          isAffiliateRestrictedNow(affiliate.is_affiliate_restricted, affiliate.affiliate_restricted_until)
            ? "Restricted"
            : "Active",
          affiliate.affiliate_restricted_until ? toIsoDateKey(affiliate.affiliate_restricted_until) : "N/A",
        ];
      });

      const csvLines = [headers.join(","), ...rows.map((row) => row.map(escapeCsv).join(","))];
      return Buffer.from(csvLines.join("\n"), "utf8");
    } catch (error) {
      if (error instanceof AppError) throw error;

      throw createAffiliateMgmtError(
        AffiliateMgmtErrorCode.EXPORT_GENERATION_FAILED,
        "Failed to generate affiliate export",
        500,
        this.requestId
      );
    }
  }

  async listAffiliateCommissions(
    filters: AffiliateCommissionListFilters,
  ): Promise<{
    commissions: AffiliateCommissionRow[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
      has_next: boolean;
      has_previous: boolean;
    };
  }> {
    const page = Math.max(1, filters.page);
    const limit = Math.max(1, Math.min(filters.limit, 100));
    const skip = (page - 1) * limit;
    const search = normalizeText(filters.search);
    const dir = filters.sort_dir ?? "desc";

    // ── Map frontend sort_by field → Prisma shopCommission orderBy ─────────────
    // Fields that live directly on shopCommission are sorted at the DB level.
    // Fields that require a relation join (affiliate_name) are sorted via
    // Prisma's relation orderBy syntax.
    const buildCommissionOrderBy = (): Prisma.ShopCommissionOrderByWithRelationInput[] => {
      switch (filters.sort_by) {
        case "product_id":
          // product_id is derived from metadata (JSON) or order items at query time,
          // so we fall back to created_at as a stable secondary tie-breaker.
          return [{ created_at: dir }, { shop_commission_id: dir }];
        case "affiliate_code":
          return [{ affiliate_code: dir }, { shop_commission_id: dir }];
        case "affiliate_user_id":
          return [{ affiliate_user_id: dir }, { shop_commission_id: dir }];
        case "affiliate_name":
          return [
            { affiliateUser: { first_name: dir } },
            { affiliateUser: { last_name: dir } },
            { shop_commission_id: dir },
          ];
        case "commission_rate":
          return [{ commission_rate: dir }, { shop_commission_id: dir }];
        case "commission_amount":
          return [{ commission_amount: dir }, { shop_commission_id: dir }];
        case "status":
          return [{ status: dir }, { created_at: "desc" }, { shop_commission_id: "desc" }];
        default:
          // Default: newest first
          return [{ created_at: "desc" }, { shop_commission_id: "desc" }];
      }
    };

    // ── Map frontend sort_by field → Prisma User orderBy (fallback path) ───────
    const buildUserOrderBy = (): Prisma.UserOrderByWithRelationInput[] => {
      switch (filters.sort_by) {
        case "affiliate_code":
          return [{ affiliate_code: dir }, { user_id: dir }];
        case "affiliate_user_id":
          return [{ user_id: dir }];
        case "affiliate_name":
          return [{ first_name: dir }, { last_name: dir }, { user_id: dir }];
        case "commission_rate":
          return [{ commission_rate: dir }, { user_id: dir }];
        default:
          return [{ affiliate_joined_at: "desc" }, { created_at: "desc" }];
      }
    };

    const statusWhere =
      filters.status && filters.status !== "all" ? { status: filters.status } : {};

    const searchWhere = search
      ? {
          OR: [
            { affiliate_code: { contains: search } },
            { status: { contains: search } },
            { shopOrder: { order_number: { contains: search } } },
            { affiliateUser: { email: { contains: search } } },
          ],
        }
      : {};

    const commissionWhere = { ...statusWhere, ...searchWhere };

    const [total, rows] = await Promise.all([
      prisma.shopCommission.count({ where: commissionWhere }),
      prisma.shopCommission.findMany({
        where: commissionWhere,
        include: {
          shopOrder: {
            select: {
              order_number: true,
              total_amount: true,
              items: {
                select: {
                  item_id: true,
                  item_type: true,
                  custom_data: true,
                },
                take: 3,
              },
            },
          },
          affiliateUser: {
            select: {
              user_id: true,
              first_name: true,
              last_name: true,
              affiliate_code: true,
              email: true,
              commission_rate: true,
            },
          },
        },
        orderBy: buildCommissionOrderBy(),
        skip,
        take: limit,
      }),
    ]);

    const commissions = rows.map((row) => {
      const metadata =
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};
      const metadataProductId =
        typeof metadata.product_id === "string" || typeof metadata.product_id === "number"
          ? String(metadata.product_id)
          : typeof metadata.item_id === "string" || typeof metadata.item_id === "number"
            ? String(metadata.item_id)
            : null;

      const fallbackItem = row.shopOrder.items.find((item) =>
        ["merchandise", "subscription_plan", "template"].includes(item.item_type),
      );

      return {
        commission_id: row.shop_commission_id.toString(),
        product_id: metadataProductId ?? fallbackItem?.item_id?.toString() ?? null,
        affiliate_code: row.affiliate_code ?? row.affiliateUser.affiliate_code ?? null,
        affiliate_user_id: row.affiliate_user_id.toString(),
        affiliate_name: `${row.affiliateUser.first_name} ${row.affiliateUser.last_name}`.trim() || row.affiliateUser.email,
        commission_rate: round2(Number(row.commission_rate)),
        commission_amount: round2(Number(row.commission_amount)),
        order_total: round2(Number(row.shopOrder.total_amount)),
        order_number: row.shopOrder.order_number,
        status: row.status,
        created_at: row.created_at.toISOString(),
      };
    });

    if (commissions.length === 0) {
      // ── Fallback: no commission rows exist yet — list affiliate users instead ─
      const affiliateFallbackWhere: Prisma.UserWhereInput = {
        AND: [
          this.buildAffiliateBaseWhere(),
          ...(search
            ? [
                {
                  OR: [
                    { affiliate_code: { contains: search } },
                    { email: { contains: search } },
                    { first_name: { contains: search } },
                    { last_name: { contains: search } },
                  ],
                },
              ]
            : []),
        ],
      };

      const [affiliateTotal, affiliateRows] = await Promise.all([
        prisma.user.count({ where: affiliateFallbackWhere }),
        prisma.user.findMany({
          where: affiliateFallbackWhere,
          orderBy: buildUserOrderBy(),
          skip,
          take: limit,
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            affiliate_code: true,
            commission_rate: true,
            email: true,
            created_at: true,
          },
        }),
      ]);

      const fallbackPages = Math.max(1, Math.ceil(affiliateTotal / limit));
      return {
        commissions: affiliateRows.map((row) => ({
          commission_id: `user_${row.user_id.toString()}`,
          product_id: null,
          affiliate_code: row.affiliate_code,
          affiliate_user_id: row.user_id.toString(),
          affiliate_name: `${row.first_name} ${row.last_name}`.trim() || row.email,
          commission_rate: round2(Number(row.commission_rate ?? DEFAULT_COMMISSION_RATE)),
          commission_amount: 0,
          order_total: 0,
          order_number: null,
          status: "pending",
          created_at: row.created_at.toISOString(),
        })),
        pagination: {
          page,
          limit,
          total: affiliateTotal,
          pages: fallbackPages,
          has_next: page < fallbackPages,
          has_previous: page > 1,
        },
      };
    }

    const pages = Math.max(1, Math.ceil(total / limit));
    return {
      commissions,
      pagination: {
        page,
        limit,
        total,
        pages,
        has_next: page < pages,
        has_previous: page > 1,
      },
    };
  }

  async voidAffiliateCommission(
    commissionId: bigint,
    performedBy: string,
    context?: AffiliateActorContext,
  ): Promise<{ commission_id: string; status: string }> {
    const existing = await prisma.shopCommission.findUnique({
      where: { shop_commission_id: commissionId },
      select: {
        shop_commission_id: true,
        affiliate_user_id: true,
        status: true,
      },
    });

    if (!existing) {
      throw createAffiliateMgmtError(
        AffiliateMgmtErrorCode.AFFILIATE_NOT_FOUND,
        "Commission record not found",
        404,
        this.requestId,
        { commissionId: commissionId.toString() }
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const commission = await tx.shopCommission.update({
        where: { shop_commission_id: commissionId },
        data: {
          status: "voided",
          processed_at: new Date(),
        },
        select: {
          shop_commission_id: true,
          affiliate_user_id: true,
          status: true,
        },
      });

      await tx.affiliateAuditLog.create({
        data: {
          affiliate_user_id: commission.affiliate_user_id,
          action: "void_commission",
          performed_by: BigInt(performedBy),
          old_values: toJsonString({ status: existing.status, commission_id: existing.shop_commission_id.toString() }),
          new_values: toJsonString({ status: commission.status, commission_id: commission.shop_commission_id.toString() }),
          ip_address: context?.ipAddress ?? null,
          user_agent: context?.userAgent ?? null,
          request_id: this.requestId,
        },
      });

      return commission;
    });

    return {
      commission_id: updated.shop_commission_id.toString(),
      status: updated.status,
    };
  }
}

