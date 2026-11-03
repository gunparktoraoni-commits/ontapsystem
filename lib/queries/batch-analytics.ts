import { prisma } from "@/server/lib/prisma";
import { prismaAnalytics } from "@/server/lib/prisma-analytics";

export type BatchDateRange = {
  start: Date;
  end: Date;
};

export type UserAnalyticsSummary = {
  profile_views: number;
  contact_saves: number;
  inquiries: number;
  connections: number;
};

export async function batchGetUserAnalytics(
  userIds: bigint[],
  dateRange: BatchDateRange
): Promise<Map<bigint, UserAnalyticsSummary>> {
  if (userIds.length === 0) return new Map();

  const [views, contactSaves, inquiries, outgoingConnections, incomingConnections] = await Promise.all([
    prismaAnalytics.portfolioView.groupBy({
      by: ["portfolio_owner_id"],
      where: {
        portfolio_owner_id: { in: userIds },
        created_at: { gte: dateRange.start, lte: dateRange.end },
      },
      _count: { _all: true },
    }),
    prismaAnalytics.contactSave.groupBy({
      by: ["portfolio_owner_id"],
      where: {
        portfolio_owner_id: { in: userIds },
        created_at: { gte: dateRange.start, lte: dateRange.end },
      },
      _count: { _all: true },
    }),
    prisma.inquiry.groupBy({
      by: ["user_id"],
      where: {
        user_id: { in: userIds },
        created_at: { gte: dateRange.start, lte: dateRange.end },
      },
      _count: { _all: true },
    }),
    prisma.connection.groupBy({
      by: ["requester_user_id"],
      where: {
        requester_user_id: { in: userIds },
        status: "accepted",
        created_at: { gte: dateRange.start, lte: dateRange.end },
      },
      _count: { _all: true },
    }),
    prisma.connection.groupBy({
      by: ["recipient_user_id"],
      where: {
        recipient_user_id: { in: userIds },
        status: "accepted",
        created_at: { gte: dateRange.start, lte: dateRange.end },
      },
      _count: { _all: true },
    }),
  ]);

  const result = new Map<bigint, UserAnalyticsSummary>();

  const getOrCreate = (userId: bigint): UserAnalyticsSummary => {
    const existing = result.get(userId);
    if (existing) return existing;

    const next: UserAnalyticsSummary = {
      profile_views: 0,
      contact_saves: 0,
      inquiries: 0,
      connections: 0,
    };
    result.set(userId, next);
    return next;
  };

  for (const row of views) {
    const target = getOrCreate(row.portfolio_owner_id);
    target.profile_views = row._count._all;
  }

  for (const row of contactSaves) {
    const target = getOrCreate(row.portfolio_owner_id);
    target.contact_saves = row._count._all;
  }

  for (const row of inquiries) {
    const target = getOrCreate(row.user_id);
    target.inquiries = row._count._all;
  }

  for (const row of outgoingConnections) {
    const target = getOrCreate(row.requester_user_id);
    target.connections += row._count._all;
  }

  for (const row of incomingConnections) {
    const target = getOrCreate(row.recipient_user_id);
    target.connections += row._count._all;
  }

  return result;
}

export type CompanyMetricsSummary = {
  total_employees: number;
  active_employees: number;
  total_bizcards: number;
  total_scans: number;
};

export async function batchGetCompanyMetrics(
  companyIds: bigint[]
): Promise<Map<bigint, CompanyMetricsSummary>> {
  if (companyIds.length === 0) return new Map();

  const [employeeTotals, activeEmployeeTotals, bizcardTotals] = await Promise.all([
    prisma.companyEmployee.groupBy({
      by: ["company_id"],
      where: {
        company_id: { in: companyIds },
      },
      _count: { _all: true },
    }),
    prisma.companyEmployee.groupBy({
      by: ["company_id"],
      where: {
        company_id: { in: companyIds },
        is_active: true,
      },
      _count: { _all: true },
    }),
    prisma.bizcard.groupBy({
      by: ["company_id"],
      where: {
        company_id: { in: companyIds },
        deactivated_flag: false,
      },
      _count: { _all: true },
      _sum: { scan_count: true },
    }),
  ]);

  const result = new Map<bigint, CompanyMetricsSummary>();

  const getOrCreate = (companyId: bigint): CompanyMetricsSummary => {
    const existing = result.get(companyId);
    if (existing) return existing;

    const next: CompanyMetricsSummary = {
      total_employees: 0,
      active_employees: 0,
      total_bizcards: 0,
      total_scans: 0,
    };
    result.set(companyId, next);
    return next;
  };

  for (const row of employeeTotals) {
    const target = getOrCreate(row.company_id);
    target.total_employees = row._count._all;
  }

  for (const row of activeEmployeeTotals) {
    const target = getOrCreate(row.company_id);
    target.active_employees = row._count._all;
  }

  for (const row of bizcardTotals) {
    if (!row.company_id) continue;

    const target = getOrCreate(row.company_id);
    target.total_bizcards = row._count._all;
    target.total_scans = Number(row._sum.scan_count ?? 0);
  }

  return result;
}
