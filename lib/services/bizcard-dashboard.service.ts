import { addDays, addMonths, differenceInCalendarDays, endOfDay, endOfMonth, endOfWeek, format, startOfDay, startOfMonth, startOfWeek, subDays } from "date-fns";
import { prisma } from "@/server/lib/prisma";
import { prismaAnalytics } from "@/server/lib/prisma-analytics";
import { buildVCardPublicUrl } from "@/server/lib/qr";
import {
  buildBizcardInquiryWhere,
  countBizcardContactSaves,
  countBizcardPortfolioViews,
  isSoleActiveBizcardForOwner,
} from "@/server/lib/analytics";
import { BizcardDashboardErrorCode, createBizcardDashboardError } from "@/lib/errors/bizcard-dashboard-errors";

export type DashboardType = "all" | "single";
export type DateFilterType = "today" | "yesterday" | "this_week" | "this_month" | "custom";

export interface ChecklistItem {
  field: string;
  is_filled: boolean;
}

export interface InquiryListItem {
  id: string;
  name: string | null;
  email: string | null;
  message: string | null;
  created_at: Date;
}

export interface BizcardDashboardData {
  bizcard_id?: bigint;
  bizcard_name?: string;
  url_alias?: string | null;
  serial_id?: string | null;
  portfolioUrl?: string | null;
  metrics: {
    totalViews: number;
    totalContactSaves: number;
    totalInquiries: number;
    totalConnections: number;
  };
  is_premium: boolean;
  subscription_tier?: string | null;
  inquiries_list?: InquiryListItem[];
  checklist?: ChecklistItem[];
  recent_activities: ActivityItem[];
  chart_data: ChartData;
  comparisons: ComparisonData;
}

export interface ActivityItem {
  id: string;
  type: "profile_view" | "contact_save" | "inquiry" | "connection";
  description: string;
  source: string;
  timestamp: Date;
  time_ago: string;
}

export interface ChartData {
  labels: string[];
  profile_views: number[];
  contact_saves: number[];
  inquiries: number[];
}

export interface ComparisonData {
  profile_views: { current: number; previous: number; percentage: number; direction: "up" | "down" | "same" };
  contact_saves: { current: number; previous: number; percentage: number; direction: "up" | "down" | "same" };
  inquiries: { current: number; previous: number; percentage: number; direction: "up" | "down" | "same" };
  connections: { current: number; previous: number; percentage: number; direction: "up" | "down" | "same" };
}

export interface BizcardDashboardResponse {
  bizcards: BizcardDashboardData[];
}

export interface BizcardDashboardDateRange {
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
}

export interface BizcardDashboardIdentifier {
  bizcardId?: bigint;
  serialId?: string;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function parseBizcardIdentifier(input: string): BizcardDashboardIdentifier | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    return { bizcardId: BigInt(trimmed) };
  }
  if (/^[a-zA-Z0-9][a-zA-Z0-9-]{1,98}[a-zA-Z0-9]$/.test(trimmed)) {
    return { serialId: trimmed };
  }
  return null;
}

export function resolveBizcardDashboardDateRange(
  filter: DateFilterType,
  customStartDate?: string,
  customEndDate?: string
): BizcardDashboardDateRange {
  const now = new Date();

  switch (filter) {
    case "today": {
      const start = startOfDay(now);
      const end = endOfDay(now);
      return {
        start,
        end,
        previousStart: startOfDay(subDays(now, 1)),
        previousEnd: endOfDay(subDays(now, 1)),
      };
    }
    case "yesterday": {
      const yesterday = subDays(now, 1);
      const start = startOfDay(yesterday);
      const end = endOfDay(yesterday);
      return {
        start,
        end,
        previousStart: startOfDay(subDays(yesterday, 1)),
        previousEnd: endOfDay(subDays(yesterday, 1)),
      };
    }
    case "this_week": {
      const start = startOfWeek(now, { weekStartsOn: 1 });
      const end = endOfWeek(now, { weekStartsOn: 1 });
      return {
        start,
        end,
        previousStart: startOfWeek(subDays(now, 7), { weekStartsOn: 1 }),
        previousEnd: endOfWeek(subDays(now, 7), { weekStartsOn: 1 }),
      };
    }
    case "this_month": {
      const start = startOfMonth(now);
      const end = endOfMonth(now);
      const previousMonth = addMonths(now, -1);
      return {
        start,
        end,
        previousStart: startOfMonth(previousMonth),
        previousEnd: endOfMonth(previousMonth),
      };
    }
    case "custom": {
      if (!customStartDate || !customEndDate) {
        throw new Error("Custom date range requires start_date and end_date.");
      }

      const start = startOfDay(new Date(customStartDate));
      const end = endOfDay(new Date(customEndDate));
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
        throw new Error("Custom date range is invalid.");
      }

      const spanDays = differenceInCalendarDays(end, start) + 1;
      const previousEnd = endOfDay(subDays(start, 1));
      const previousStart = startOfDay(subDays(previousEnd, spanDays - 1));

      return { start, end, previousStart, previousEnd };
    }
    default:
      throw new Error(`Invalid filter type: ${filter}`);
  }
}

function calculateComparison(current: number, previous: number): {
  current: number;
  previous: number;
  percentage: number;
  direction: "up" | "down" | "same";
} {
  const percentage = previous === 0 ? (current > 0 ? 100 : 0) : ((current - previous) / previous) * 100;
  const direction = percentage > 0 ? "up" : percentage < 0 ? "down" : "same";

  return {
    current,
    previous,
    percentage: Math.round(percentage * 100) / 100,
    direction,
  };
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

function serializeBigInt(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_, current) => (typeof current === "bigint" ? current.toString() : current))
  );
}

type BizcardRow = {
  bizcard_id: bigint;
  bizcard_name: string;
  url_alias: string | null;
  serial_id: string | null;
  portfolio_url: string | null;
  profile_img: string | null;
  bio: string | null;
  email: string | null;
  contact_number: string | null;
  address_link: string | null;
  subscription_tier: string | null;
  user_id: bigint | null;
};

export class BizcardDashboardService {
  private readonly requestId: string;
  private readonly userId: bigint;
  private readonly target?: BizcardDashboardIdentifier;

  constructor(requestId: string, userId: bigint, target?: BizcardDashboardIdentifier) {
    this.requestId = requestId;
    this.userId = userId;
    this.target = target;
  }

  async getUserBizcards(): Promise<BizcardRow[]> {
    return prisma.bizcard.findMany({
      where: {
        user_id: this.userId,
        deactivated_flag: false,
      },
      select: {
        bizcard_id: true,
        bizcard_name: true,
        url_alias: true,
        serial_id: true,
        portfolio_url: true,
        profile_img: true,
        bio: true,
        email: true,
        contact_number: true,
        address_link: true,
        subscription_tier: true,
        user_id: true,
      },
      orderBy: { created_at: "desc" },
    });
  }

  async getDashboardData(
    filter: DateFilterType = "today",
    customStartDate?: string,
    customEndDate?: string
  ): Promise<BizcardDashboardData | BizcardDashboardResponse> {
    if (this.target?.bizcardId || this.target?.serialId) {
      const resolved = await this.resolveTargetBizcard();
      if (!resolved) {
        throw createBizcardDashboardError(
          BizcardDashboardErrorCode.BIZCARD_NOT_FOUND,
          "Bizcard not found",
          404,
          this.requestId,
          {
            ...(this.target.bizcardId ? { bizcardId: this.target.bizcardId.toString() } : {}),
            ...(this.target.serialId ? { serialId: this.target.serialId } : {}),
          }
        );
      }

      if (resolved.user_id !== this.userId) {
        throw createBizcardDashboardError(
          BizcardDashboardErrorCode.BIZCARD_ACCESS_DENIED,
          "You do not have access to this bizcard",
          403,
          this.requestId,
          {
            bizcardId: resolved.bizcard_id.toString(),
            serialId: resolved.serial_id,
          }
        );
      }

      return this.buildSingleBizcardDashboard(resolved, filter, customStartDate, customEndDate);
    }

    const bizcards = await this.getUserBizcards();
    if (bizcards.length === 0) {
      throw createBizcardDashboardError(
        BizcardDashboardErrorCode.NO_BIZCARDS_FOUND,
        "No bizcards found for this account",
        404,
        this.requestId,
        { userId: this.userId.toString() }
      );
    }

    const dashboards = await Promise.all(
      bizcards.map((bizcard) => this.buildSingleBizcardDashboard(bizcard, filter, customStartDate, customEndDate))
    );

    return { bizcards: dashboards };
  }

  private async resolveTargetBizcard(): Promise<BizcardRow | null> {
    if (this.target?.bizcardId) {
      return prisma.bizcard.findFirst({
        where: {
          bizcard_id: this.target.bizcardId,
          deactivated_flag: false,
        },
        select: {
          bizcard_id: true,
          bizcard_name: true,
          url_alias: true,
          serial_id: true,
          portfolio_url: true,
          profile_img: true,
          bio: true,
          email: true,
          contact_number: true,
          address_link: true,
          subscription_tier: true,
          user_id: true,
        },
      });
    }

    if (this.target?.serialId) {
      return prisma.bizcard.findFirst({
        where: {
          serial_id: this.target.serialId,
          deactivated_flag: false,
        },
        select: {
          bizcard_id: true,
          bizcard_name: true,
          url_alias: true,
          serial_id: true,
          portfolio_url: true,
          profile_img: true,
          bio: true,
          email: true,
          contact_number: true,
          address_link: true,
          subscription_tier: true,
          user_id: true,
        },
      });
    }

    return null;
  }

  private async buildSingleBizcardDashboard(
    bizcard: BizcardRow,
    filter: DateFilterType,
    customStartDate?: string,
    customEndDate?: string
  ): Promise<BizcardDashboardData> {
    const dateRange = resolveBizcardDashboardDateRange(filter, customStartDate, customEndDate);

    const [currentMetrics, previousMetrics, chartData, recentActivities, checklist] = await Promise.all([
      this.getMetricsForRange(bizcard, dateRange.start, dateRange.end),
      this.getMetricsForRange(bizcard, dateRange.previousStart, dateRange.previousEnd),
      this.getChartData(bizcard, dateRange.start, dateRange.end),
      this.getRecentActivities(bizcard, dateRange.end),
      this.getChecklistItems(bizcard.bizcard_id, bizcard),
    ]);

    const portfolioUrl = bizcard.portfolio_url || (bizcard.url_alias ? buildVCardPublicUrl(bizcard.url_alias) : null);
    const owner = await prisma.user.findUnique({
      where: { user_id: bizcard.user_id ?? this.userId },
      select: { role: true },
    });
    const ownerRole = String(owner?.role ?? "")
      .trim()
      .toLowerCase();
    const isPremium =
      ownerRole === "super_admin" ||
      ownerRole === "dev" ||
      (!!bizcard.subscription_tier && bizcard.subscription_tier.toLowerCase() === "premium");

    return {
      bizcard_id: bizcard.bizcard_id,
      bizcard_name: bizcard.bizcard_name,
      url_alias: bizcard.url_alias ?? null,
      serial_id: bizcard.serial_id ?? null,
      portfolioUrl: portfolioUrl,
      metrics: {
        totalViews: currentMetrics.profile_views,
        totalContactSaves: currentMetrics.contact_saves,
        totalInquiries: currentMetrics.inquiries,
        totalConnections: currentMetrics.connections,
      },
      is_premium: isPremium,
      subscription_tier: isPremium ? "premium" : bizcard.subscription_tier,
      inquiries_list: isPremium ? await this.getRecentInquiries(bizcard) : [],
      checklist,
      recent_activities: recentActivities,
      chart_data: chartData,
      comparisons: {
        profile_views: calculateComparison(currentMetrics.profile_views, previousMetrics.profile_views),
        contact_saves: calculateComparison(currentMetrics.contact_saves, previousMetrics.contact_saves),
        inquiries: calculateComparison(currentMetrics.inquiries, previousMetrics.inquiries),
        connections: calculateComparison(currentMetrics.connections, previousMetrics.connections),
      },
    };
  }

  private async getMetricsForRange(
    bizcard: BizcardRow,
    startDate: Date,
    endDate: Date,
  ): Promise<{
    profile_views: number;
    contact_saves: number;
    inquiries: number;
    connections: number;
  }> {
    const ownerId = bizcard.user_id ?? this.userId;
    const range = { gte: startDate, lte: endDate };
    const sole = await isSoleActiveBizcardForOwner(ownerId, bizcard.bizcard_id);
    const inquiryWhere = buildBizcardInquiryWhere(ownerId, bizcard.bizcard_id, sole);

    const [profileViews, contactSaves, inquiries, connections] = await Promise.all([
      countBizcardPortfolioViews(ownerId, bizcard.bizcard_id, range),
      countBizcardContactSaves(ownerId, bizcard.bizcard_id, range),
      prisma.inquiry.count({
        where: { ...inquiryWhere, created_at: range },
      }),
      prisma.connection.count({
        where: {
          bizcard_id: bizcard.bizcard_id,
          status: "accepted",
          created_at: range,
        },
      }),
    ]);

    return {
      profile_views: profileViews,
      contact_saves: contactSaves,
      inquiries,
      connections,
    };
  }

  private async getRecentInquiries(bizcard: BizcardRow): Promise<InquiryListItem[]> {
    const ownerId = bizcard.user_id ?? this.userId;
    const sole = await isSoleActiveBizcardForOwner(ownerId, bizcard.bizcard_id);
    const inquiryWhere = buildBizcardInquiryWhere(ownerId, bizcard.bizcard_id, sole);
    const inquiries = await prisma.inquiry.findMany({
      where: inquiryWhere,
      orderBy: { created_at: "desc" },
      take: 10,
      select: {
        inquiry_id: true,
        visitor_name: true,
        visitor_email: true,
        message: true,
        created_at: true,
      },
    });

    return inquiries.map((entry) => ({
      id: entry.inquiry_id.toString(),
      name: entry.visitor_name,
      email: entry.visitor_email,
      message: entry.message,
      created_at: entry.created_at,
    }));
  }

  private async getChecklistItems(bizcardId: bigint, bizcard: BizcardRow): Promise<ChecklistItem[]> {
    const [socialCount, serviceCount, productCount, addressCount] = await Promise.all([
      prisma.social.count({ where: { bizcard_id: bizcardId, deleted_at: null } }),
      prisma.service.count({ where: { bizcard_id: bizcardId } }),
      prisma.product.count({ where: { bizcard_id: bizcardId } }),
      prisma.address.count({ where: { bizcard_id: bizcardId } }),
    ]);

    return [
      { field: "Profile Image", is_filled: Boolean(bizcard.profile_img) },
      { field: "Bio", is_filled: Boolean(bizcard.bio) },
      { field: "Email", is_filled: Boolean(bizcard.email) },
      { field: "Phone", is_filled: Boolean(bizcard.contact_number) },
      { field: "Address", is_filled: Boolean(bizcard.address_link) || addressCount > 0 },
      { field: "Social Links", is_filled: socialCount > 0 },
      { field: "Services", is_filled: serviceCount > 0 },
      { field: "Products", is_filled: productCount > 0 },
    ];
  }

  private async getChartData(bizcard: BizcardRow, startDate: Date, endDate: Date): Promise<ChartData> {
    const ownerId = bizcard.user_id ?? this.userId;
    const dayCount = differenceInCalendarDays(endDate, startDate) + 1;
    const labels: string[] = [];
    const profileViews: number[] = [];
    const contactSaves: number[] = [];
    const inquiries: number[] = [];
    const sole = await isSoleActiveBizcardForOwner(ownerId, bizcard.bizcard_id);
    const inquiryWhere = buildBizcardInquiryWhere(ownerId, bizcard.bizcard_id, sole);

    for (let index = 0; index < dayCount; index += 1) {
      const currentDate = addDays(startDate, index);
      const dayStart = startOfDay(currentDate);
      const dayEnd = endOfDay(currentDate);
      const range = { gte: dayStart, lte: dayEnd };

      labels.push(format(currentDate, "MMM dd"));

      const [views, saves, inqs] = await Promise.all([
        countBizcardPortfolioViews(ownerId, bizcard.bizcard_id, range),
        countBizcardContactSaves(ownerId, bizcard.bizcard_id, range),
        prisma.inquiry.count({
          where: { ...inquiryWhere, created_at: range },
        }),
      ]);

      profileViews.push(views);
      contactSaves.push(saves);
      inquiries.push(inqs);
    }

    return { labels, profile_views: profileViews, contact_saves: contactSaves, inquiries };
  }

  private async getRecentActivities(bizcard: BizcardRow, rangeEnd: Date): Promise<ActivityItem[]> {
    const ownerId = bizcard.user_id ?? this.userId;
    const bizcardId = bizcard.bizcard_id;
    const rangeStart = startOfDay(subDays(rangeEnd, 29));
    const limit = 10;
    const sole = await isSoleActiveBizcardForOwner(ownerId, bizcardId);
    const inquiryWhere = buildBizcardInquiryWhere(ownerId, bizcardId, sole);

    const viewWhere = sole
      ? { portfolio_owner_id: ownerId, created_at: { gte: rangeStart, lte: rangeEnd } }
      : { portfolio_owner_id: ownerId, bizcard_id: bizcardId, created_at: { gte: rangeStart, lte: rangeEnd } };
    const saveWhere = sole
      ? { portfolio_owner_id: ownerId, created_at: { gte: rangeStart, lte: rangeEnd } }
      : { portfolio_owner_id: ownerId, bizcard_id: bizcardId, created_at: { gte: rangeStart, lte: rangeEnd } };

    type PortfolioViewRow = {
      id: bigint;
      created_at: Date;
      referrer: string | null;
      device_type: string | null;
      browser: string | null;
    };

    type ContactSaveRow = {
      id: bigint;
      created_at: Date;
      save_type: string;
      device_type: string | null;
      browser: string | null;
    };

    type InquiryRow = {
      inquiry_id: bigint;
      created_at: Date;
      subject: string | null;
      visitor_name: string | null;
      visitor_email: string | null;
      sender: {
        first_name: string | null;
        last_name: string | null;
        email: string | null;
      } | null;
    };

    type ConnectionRow = {
      connect_id: bigint;
      created_at: Date;
      status: string;
      requester: {
        first_name: string | null;
        last_name: string | null;
        email: string | null;
      } | null;
    };

    const [views, saves, inquiries, connections]: [
      PortfolioViewRow[],
      ContactSaveRow[],
      InquiryRow[],
      ConnectionRow[],
    ] = await Promise.all([
      prismaAnalytics.portfolioView.findMany({
        where: viewWhere,
        orderBy: { created_at: "desc" },
        take: limit,
        select: {
          id: true,
          created_at: true,
          referrer: true,
          device_type: true,
          browser: true,
        },
      }),
      prismaAnalytics.contactSave.findMany({
        where: saveWhere,
        orderBy: { created_at: "desc" },
        take: limit,
        select: {
          id: true,
          created_at: true,
          save_type: true,
          device_type: true,
          browser: true,
        },
      }),
      prisma.inquiry.findMany({
        where: { ...inquiryWhere, created_at: { gte: rangeStart, lte: rangeEnd } },
        orderBy: { created_at: "desc" },
        take: limit,
        select: {
          inquiry_id: true,
          created_at: true,
          subject: true,
          visitor_name: true,
          visitor_email: true,
          sender: {
            select: {
              first_name: true,
              last_name: true,
              email: true,
            },
          },
        },
      }),
      prisma.connection.findMany({
        where: { bizcard_id: bizcardId, created_at: { gte: rangeStart, lte: rangeEnd } },
        orderBy: { created_at: "desc" },
        take: limit,
        select: {
          connect_id: true,
          created_at: true,
          status: true,
          requester: {
            select: {
              first_name: true,
              last_name: true,
              email: true,
            },
          },
        },
      }),
    ]);

    const activities: ActivityItem[] = [
      ...views.map((entry) => ({
        id: `view_${entry.id.toString()}`,
        type: "profile_view" as const,
        description: "Profile viewed",
        source: entry.referrer || entry.browser || entry.device_type || "Direct",
        timestamp: entry.created_at,
        time_ago: getTimeAgo(entry.created_at),
      })),
      ...saves.map((entry) => ({
        id: `save_${entry.id.toString()}`,
        type: "contact_save" as const,
        description: `Contact saved (${entry.save_type})`,
        source: entry.browser || entry.device_type || entry.save_type,
        timestamp: entry.created_at,
        time_ago: getTimeAgo(entry.created_at),
      })),
      ...inquiries.map((entry) => ({
        id: `inquiry_${entry.inquiry_id.toString()}`,
        type: "inquiry" as const,
        description: `New inquiry: ${entry.subject || "General inquiry"}`,
        source:
          entry.sender
            ? `${entry.sender.first_name ?? ""} ${entry.sender.last_name ?? ""}`.trim() || entry.sender.email || "Anonymous"
            : entry.visitor_email || entry.visitor_name || "Anonymous",
        timestamp: entry.created_at,
        time_ago: getTimeAgo(entry.created_at),
      })),
      ...connections.map((entry) => ({
        id: `conn_${entry.connect_id.toString()}`,
        type: "connection" as const,
        description: entry.status === "accepted" ? "Connection accepted" : "Connection request received",
        source:
          entry.requester
            ? `${entry.requester.first_name ?? ""} ${entry.requester.last_name ?? ""}`.trim() || entry.requester.email || "Network"
            : "Network",
        timestamp: entry.created_at,
        time_ago: getTimeAgo(entry.created_at),
      })),
    ];

    return activities.sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime()).slice(0, limit);
  }
}

export function serializeBizcardDashboardResponse(value: unknown): unknown {
  return serializeBigInt(value);
}
