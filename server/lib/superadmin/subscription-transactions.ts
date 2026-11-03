import { prisma } from "@/server/lib/prisma";

export type SuperAdminSubscriptionTransactionType =
  | "renewal"
  | "upgrade"
  | "downgrade"
  | "cancellation";

export type SuperAdminSubscriptionTransactionsFilters = {
  page: number;
  limit: number;
  type?: "all" | SuperAdminSubscriptionTransactionType;
  search?: string;
  from?: string;
  to?: string;
};

export type SuperAdminSubscriptionTransactionRow = {
  transaction_id: string;
  type: SuperAdminSubscriptionTransactionType;
  user_id: string | null;
  user_email: string | null;
  bizcard_id: string;
  bizcard_serial: string | null;
  from_plan: string | null;
  to_plan: string | null;
  amount: number;
  status: string;
  effective_date: string;
  created_at: string;
  order_number: string | null;
};

function mapUpgradeType(raw: string): SuperAdminSubscriptionTransactionType {
  const value = raw.toLowerCase();
  if (value.includes("cancel")) return "cancellation";
  if (value.includes("downgrade")) return "downgrade";
  return "upgrade";
}

function toDateRange(filters: SuperAdminSubscriptionTransactionsFilters): {
  gte?: Date;
  lte?: Date;
} {
  const range: { gte?: Date; lte?: Date } = {};
  if (filters.from) {
    const from = new Date(filters.from);
    if (!Number.isNaN(from.getTime())) range.gte = from;
  }
  if (filters.to) {
    const to = new Date(filters.to);
    if (!Number.isNaN(to.getTime())) {
      to.setHours(23, 59, 59, 999);
      range.lte = to;
    }
  }
  return range;
}

export async function listSuperAdminSubscriptionTransactions(
  filters: SuperAdminSubscriptionTransactionsFilters,
): Promise<{
  rows: SuperAdminSubscriptionTransactionRow[];
  counts: {
    renewal: number;
    upgrade: number;
    downgrade: number;
    cancellation: number;
  };
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
  const search = filters.search?.trim().toLowerCase();
  const dateRange = toDateRange(filters);

  const [upgradeLogs, renewalLogs] = await Promise.all([
    prisma.subscriptionUpgradeLog.findMany({
      where: {
        ...(filters.type && filters.type !== "all"
          ? filters.type === "upgrade"
            ? { upgrade_type: { notIn: ["downgrade_scheduled", "cancel_scheduled", "immediate_cancel"] } }
            : filters.type === "downgrade"
              ? { upgrade_type: { contains: "downgrade" } }
              : { upgrade_type: { contains: "cancel" } }
          : {}),
        ...(dateRange.gte || dateRange.lte ? { created_at: dateRange } : {}),
      },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      select: {
        id: true,
        upgrade_type: true,
        amount_paid: true,
        effective_date: true,
        created_at: true,
        bizcard_id: true,
        bizcard: {
          select: {
            serial_id: true,
            user_id: true,
            user: { select: { email: true } },
          },
        },
        fromPlan: { select: { name: true } },
        toPlan: { select: { name: true } },
        order: { select: { order_number: true } },
      },
    }),
    prisma.subscriptionRenewalHistory.findMany({
      where: {
        ...(filters.type === "all" || !filters.type || filters.type === "renewal"
          ? {}
          : { renewal_id: BigInt(-1) }),
        ...(dateRange.gte || dateRange.lte ? { created_at: dateRange } : {}),
      },
      orderBy: [{ created_at: "desc" }, { renewal_id: "desc" }],
      select: {
        renewal_id: true,
        bizcard_id: true,
        amount_paid: true,
        payment_transaction_id: true,
        new_expiry: true,
        renewed_at: true,
        created_at: true,
      },
    }),
  ]);

  const renewalBizcardIds = [...new Set(renewalLogs.map((log) => log.bizcard_id.toString()))].map(
    (id) => BigInt(id),
  );

  const renewalBizcards =
    renewalBizcardIds.length > 0
      ? await prisma.bizcard.findMany({
          where: { bizcard_id: { in: renewalBizcardIds } },
          select: {
            bizcard_id: true,
            serial_id: true,
            user_id: true,
            user: { select: { email: true } },
            marketplaceSubscription: {
              select: {
                plan: { select: { name: true } },
              },
            },
          },
        })
      : [];

  const renewalBizcardMap = new Map(
    renewalBizcards.map((item) => [item.bizcard_id.toString(), item]),
  );

  const mergedAll: SuperAdminSubscriptionTransactionRow[] = [
    ...upgradeLogs.map((log) => ({
      transaction_id: `upgrade_${log.id.toString()}`,
      type: mapUpgradeType(log.upgrade_type),
      user_id: log.bizcard.user_id?.toString() ?? null,
      user_email: log.bizcard.user?.email ?? null,
      bizcard_id: log.bizcard_id.toString(),
      bizcard_serial: log.bizcard.serial_id,
      from_plan: log.fromPlan?.name ?? null,
      to_plan: log.toPlan?.name ?? null,
      amount: Number(log.amount_paid ?? 0),
      status:
        mapUpgradeType(log.upgrade_type) === "cancellation"
          ? "cancelled"
          : log.upgrade_type.includes("pending")
            ? "pending"
            : "completed",
      effective_date: log.effective_date.toISOString(),
      created_at: log.created_at.toISOString(),
      order_number: log.order?.order_number ?? null,
    })),
    ...renewalLogs.map((log) => {
      const bizcard = renewalBizcardMap.get(log.bizcard_id.toString());
      return {
        transaction_id: `renewal_${log.renewal_id.toString()}`,
        type: "renewal" as const,
        user_id: bizcard?.user_id?.toString() ?? null,
        user_email: bizcard?.user?.email ?? null,
        bizcard_id: log.bizcard_id.toString(),
        bizcard_serial: bizcard?.serial_id ?? null,
        from_plan: bizcard?.marketplaceSubscription?.plan?.name ?? null,
        to_plan: bizcard?.marketplaceSubscription?.plan?.name ?? null,
        amount: Number(log.amount_paid ?? 0),
        status: "completed",
        effective_date: log.renewed_at.toISOString(),
        created_at: log.created_at.toISOString(),
        order_number: log.payment_transaction_id ?? null,
      };
    }),
  ]
    .filter((row) => {
      if (!search) return true;
      return [
        row.user_email,
        row.user_id,
        row.bizcard_serial,
        row.from_plan,
        row.to_plan,
        row.order_number,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    })
    .sort((a, b) => {
      if (a.created_at === b.created_at) return b.transaction_id.localeCompare(a.transaction_id);
      return a.created_at < b.created_at ? 1 : -1;
    });

  const counts = {
    renewal: mergedAll.filter((row) => row.type === "renewal").length,
    upgrade: mergedAll.filter((row) => row.type === "upgrade").length,
    downgrade: mergedAll.filter((row) => row.type === "downgrade").length,
    cancellation: mergedAll.filter((row) => row.type === "cancellation").length,
  };

  const merged =
    filters.type && filters.type !== "all"
      ? mergedAll.filter((row) => row.type === filters.type)
      : mergedAll;

  const total = merged.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;

  return {
    rows: merged.slice(start, start + limit),
    counts,
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
