import { prisma } from "@/server/lib/prisma";
import { getDefaultCurrency } from "@/server/lib/payment";
import type { PurchaseLog, ShopOrder, ShopOrderItem, SubscriptionPlan } from "@prisma/client";

export type BillingTxTypeFilter =
  | "all"
  | "subscription"
  | "physical_card"
  | "theme"
  | "promo"
  | "subscription_change";

export type BillingTransactionType =
  | "subscription"
  | "physical_card"
  | "theme"
  | "subscription_change";

export type BillingTransactionStatus =
  | "completed"
  | "pending"
  | "failed"
  | "refunded"
  | "scheduled"
  | "cancelled";

export type BillingHistoryFilters = {
  page: number;
  limit: number;
  type: BillingTxTypeFilter;
  status: string;
  fromDate?: string | null;
  toDate?: string | null;
};

export type BillingTransactionItem = {
  description: string;
  amount: number;
  quantity: number;
};

export type BillingTransactionMetadata = {
  upgrade_type?: string;
  bizcard_serial?: string | null;
  from_plan?: string | null;
  to_plan?: string | null;
  order_number?: string | null;
  raw_metadata?: unknown;
};

export type BillingTransaction = {
  id: string;
  source: "purchase_log" | "subscription_log";
  type: BillingTransactionType;
  description: string;
  amount: number;
  currency: string;
  formatted_amount: string;
  status: BillingTransactionStatus;
  payment_method: { type: string };
  date: Date;
  invoice_url: string | null;
  receipt_url: string;
  items: BillingTransactionItem[];
  metadata: BillingTransactionMetadata | null;
};

export type BillingHistoryResult = {
  transactions: BillingTransaction[];
  pagination: { page: number; limit: number; total: number; pages: number };
  summary: {
    total_spent: number;
    total_spent_formatted: string;
    by_type: Record<string, number>;
    by_status: Record<string, number>;
    average_transaction: number;
    last_transaction_date: Date | null;
  };
};

type HistoryStub = {
  source: "purchase_log" | "subscription_log";
  id: bigint;
  date: Date;
};

const SUBSCRIPTION_PAYMENT_TYPES = new Set([
  "upgrade",
  "new",
  "plan_change_completed",
  "plan_change_pending",
]);

const SUBSCRIPTION_CHANGE_TYPES = new Set([
  "downgrade_scheduled",
  "cancel_scheduled",
  "immediate_cancel",
]);

export function formatBillingAmount(amount: number, currency: string): string {
  try {
    const formatted = new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
    
    // Replace Unicode currency symbols with ASCII-compatible versions for PDF compatibility
    // pdf-lib's Helvetica font doesn't support special Unicode symbols
    return formatted
      .replace('₱', 'PHP ')  // Philippine Peso
      .replace('€', 'EUR ')  // Euro
      .replace('¥', 'JPY ')  // Yen
      .replace('₹', 'INR ')  // Indian Rupee
      .replace('₩', 'KRW ')  // Korean Won
      .replace('₪', 'ILS ')  // Israeli Shekel
      .replace('₨', 'PKR ')  // Pakistani Rupee
      .replace('฿', 'THB ')  // Thai Baht
      .replace('₦', 'NGN ')  // Nigerian Naira
      .replace('₡', 'CRC ')  // Costa Rican Colón
      .replace('₱', 'PHP '); // Fallback for Philippine Peso
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function parseBillingTransactionId(raw: string): {
  source: "purchase_log" | "subscription_log";
  id: bigint;
} | null {
  const trimmed = raw.trim();
  if (/^txn_\d+$/.test(trimmed)) {
    return { source: "purchase_log", id: BigInt(trimmed.slice(4)) };
  }
  if (/^sub_\d+$/.test(trimmed)) {
    return { source: "subscription_log", id: BigInt(trimmed.slice(4)) };
  }
  if (/^\d+$/.test(trimmed)) {
    return { source: "purchase_log", id: BigInt(trimmed) };
  }
  return null;
}

function parseJsonSafe(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function subscriptionDescription(
  upgradeType: string,
  fromPlan: SubscriptionPlan | null,
  toPlan: SubscriptionPlan,
): string {
  const fromName = fromPlan?.name ?? "None";
  const toName = toPlan.name;

  switch (upgradeType) {
    case "new":
      return `New subscription: ${toName}`;
    case "upgrade":
      return `Upgrade: ${fromName} → ${toName}`;
    case "plan_change_pending":
      return `Plan change (pending): ${fromName} → ${toName}`;
    case "plan_change_completed":
      return `Plan change: ${fromName} → ${toName}`;
    case "downgrade_scheduled":
      return `Downgrade scheduled: ${fromName} → ${toName}`;
    case "cancel_scheduled":
      return `Cancellation scheduled: ${fromName}`;
    case "immediate_cancel":
      return `Subscription cancelled: ${fromName}`;
    default:
      return `Subscription update: ${toName}`;
  }
}

function mapSubscriptionLogType(upgradeType: string): BillingTransactionType {
  if (SUBSCRIPTION_CHANGE_TYPES.has(upgradeType)) {
    return "subscription_change";
  }
  return "subscription";
}

function mapSubscriptionLogStatus(upgradeType: string): BillingTransactionStatus {
  if (upgradeType === "plan_change_pending") return "pending";
  if (upgradeType === "downgrade_scheduled" || upgradeType === "cancel_scheduled") return "scheduled";
  if (upgradeType === "immediate_cancel") return "cancelled";
  return "completed";
}

function mapPurchaseLogType(purchaseType: string): BillingTransactionType {
  if (purchaseType === "subscription_plan") return "subscription";
  if (purchaseType === "template") return "theme";
  return "physical_card";
}

function mapPurchaseLogStatus(status: string): BillingTransactionStatus {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "refunded") return "refunded";
  if (status === "pending") return "pending";
  return status as BillingTransactionStatus;
}

function resolveCurrency(order?: Pick<ShopOrder, "currency"> | null): string {
  return order?.currency?.toUpperCase() || getDefaultCurrency();
}

function matchesSubscriptionUpgradeTypeFilter(upgradeType: string, filter: BillingTxTypeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "subscription") return SUBSCRIPTION_PAYMENT_TYPES.has(upgradeType);
  if (filter === "subscription_change") return SUBSCRIPTION_CHANGE_TYPES.has(upgradeType);
  return false;
}

function matchesPurchaseTypeFilter(purchaseType: string, filter: BillingTxTypeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "subscription") return purchaseType === "subscription_plan";
  if (filter === "theme") return purchaseType === "template";
  if (filter === "physical_card" || filter === "promo") return purchaseType === "merchandise";
  if (filter === "subscription_change") return false;
  return true;
}

function buildDateRange(fromDate?: string | null, toDate?: string | null): { gte?: Date; lte?: Date } | undefined {
  if (!fromDate && !toDate) return undefined;
  const range: { gte?: Date; lte?: Date } = {};
  if (fromDate) range.gte = new Date(fromDate);
  if (toDate) range.lte = new Date(toDate);
  return range;
}

function mapPurchaseLogToTransaction(
  row: PurchaseLog & { order?: (ShopOrder & { items: ShopOrderItem[] }) | null },
): BillingTransaction {
  const type = mapPurchaseLogType(row.purchase_type);
  const amount = Number(row.amount);
  const currency = resolveCurrency(row.order);
  const status = mapPurchaseLogStatus(row.status);
  const parsedMeta = parseJsonSafe(row.metadata);

  const items =
    row.order?.items?.length
      ? row.order.items.map((item) => ({
          description: item.item_name,
          amount: Number(item.total_price),
          quantity: item.quantity,
        }))
      : [{ description: row.item_name, amount, quantity: 1 }];

  return {
    id: `txn_${row.id}`,
    source: "purchase_log",
    type,
    description: row.item_name,
    amount,
    currency,
    formatted_amount: formatBillingAmount(amount, currency),
    status,
    payment_method: { type: row.order?.payment_method ?? "xendit" },
    date: row.purchased_at,
    invoice_url: row.order_id ? `/api/user/billing/invoice/${row.id.toString()}` : null,
    receipt_url: `/api/user/billing/receipt/txn_${row.id}`,
    items,
    metadata: {
      order_number: row.order?.order_number ?? null,
      raw_metadata: parsedMeta,
    },
  };
}

type SubscriptionLogWithRelations = {
  id: bigint;
  bizcard_id: bigint;
  from_plan_id: bigint | null;
  to_plan_id: bigint;
  upgrade_type: string;
  amount_paid: { toString(): string } | null;
  billing_cycle: string | null;
  effective_date: Date;
  expiry_date: Date | null;
  order_id: bigint | null;
  created_at: Date;
  fromPlan: SubscriptionPlan | null;
  toPlan: SubscriptionPlan;
  bizcard: { serial_id: string | null };
  order?: (ShopOrder & { items: ShopOrderItem[] }) | null;
};

function mapSubscriptionLogToTransaction(row: SubscriptionLogWithRelations): BillingTransaction {
  const type = mapSubscriptionLogType(row.upgrade_type);
  const status = mapSubscriptionLogStatus(row.upgrade_type);
  const amount = Number(row.amount_paid ?? 0);
  const currency = resolveCurrency(row.order);
  const description = subscriptionDescription(row.upgrade_type, row.fromPlan, row.toPlan);

  return {
    id: `sub_${row.id}`,
    source: "subscription_log",
    type,
    description,
    amount,
    currency,
    formatted_amount: formatBillingAmount(amount, currency),
    status,
    payment_method: { type: "xendit" },
    date: row.effective_date,
    invoice_url: null,
    receipt_url: `/api/user/billing/receipt/sub_${row.id}`,
    items: [{ description, amount, quantity: 1 }],
    metadata: {
      upgrade_type: row.upgrade_type,
      bizcard_serial: row.bizcard.serial_id,
      from_plan: row.fromPlan?.name ?? null,
      to_plan: row.toPlan.name,
      order_number: row.order?.order_number ?? null,
    },
  };
}

async function fetchPurchaseStubs(
  userId: bigint,
  filters: BillingHistoryFilters,
): Promise<HistoryStub[]> {
  const dateRange = buildDateRange(filters.fromDate, filters.toDate);
  const rows = await prisma.purchaseLog.findMany({
    where: {
      user_id: userId,
      ...(dateRange ? { purchased_at: dateRange } : {}),
    },
    select: { id: true, purchased_at: true, purchase_type: true },
    orderBy: { purchased_at: "desc" },
  });

  return rows
    .filter((row) => matchesPurchaseTypeFilter(row.purchase_type, filters.type))
    .map((row) => ({
      source: "purchase_log" as const,
      id: row.id,
      date: row.purchased_at,
    }));
}

async function fetchSubscriptionStubs(
  userId: bigint,
  filters: BillingHistoryFilters,
): Promise<HistoryStub[]> {
  const dateRange = buildDateRange(filters.fromDate, filters.toDate);
  const rows = await prisma.subscriptionUpgradeLog.findMany({
    where: {
      bizcard: { user_id: userId },
      ...(dateRange ? { effective_date: dateRange } : {}),
    },
    select: { id: true, effective_date: true, upgrade_type: true },
    orderBy: { effective_date: "desc" },
  });

  return rows
    .filter((row) => matchesSubscriptionUpgradeTypeFilter(row.upgrade_type, filters.type))
    .map((row) => ({
      source: "subscription_log" as const,
      id: row.id,
      date: row.effective_date,
    }));
}

async function hydratePurchaseLogs(ids: bigint[], userId: bigint) {
  if (!ids.length) return [];
  const rows = await prisma.purchaseLog.findMany({
    where: { id: { in: ids }, user_id: userId },
    include: {
      order: { include: { items: true } },
    },
  });
  const byId = new Map(rows.map((row) => [row.id.toString(), row]));
  return ids.map((id) => byId.get(id.toString())).filter(Boolean) as Array<
    PurchaseLog & { order: (ShopOrder & { items: ShopOrderItem[] }) | null }
  >;
}

async function hydrateSubscriptionLogs(ids: bigint[], userId: bigint) {
  if (!ids.length) return [];
  const rows = await prisma.subscriptionUpgradeLog.findMany({
    where: {
      id: { in: ids },
      bizcard: { user_id: userId },
    },
    include: {
      fromPlan: true,
      toPlan: true,
      bizcard: { select: { serial_id: true } },
      order: { include: { items: true } },
    },
  });
  const byId = new Map(rows.map((row) => [row.id.toString(), row]));
  return ids
    .map((id) => byId.get(id.toString()))
    .filter(Boolean) as SubscriptionLogWithRelations[];
}

export async function fetchUserBillingHistory(
  userId: bigint,
  filters: BillingHistoryFilters,
): Promise<BillingHistoryResult> {
  const [purchaseStubs, subscriptionStubs] = await Promise.all([
    fetchPurchaseStubs(userId, filters),
    fetchSubscriptionStubs(userId, filters),
  ]);

  const merged = [...purchaseStubs, ...subscriptionStubs].sort(
    (a, b) => b.date.getTime() - a.date.getTime(),
  );

  const total = merged.length;
  const skip = (filters.page - 1) * filters.limit;
  const pageStubs = merged.slice(skip, skip + filters.limit);

  const purchaseIds = pageStubs.filter((s) => s.source === "purchase_log").map((s) => s.id);
  const subscriptionIds = pageStubs.filter((s) => s.source === "subscription_log").map((s) => s.id);

  const [purchaseRows, subscriptionRows] = await Promise.all([
    hydratePurchaseLogs(purchaseIds, userId),
    hydrateSubscriptionLogs(subscriptionIds, userId),
  ]);

  const purchaseMap = new Map(purchaseRows.map((row) => [`purchase_log:${row.id}`, row]));
  const subscriptionMap = new Map(
    subscriptionRows.map((row) => [`subscription_log:${row.id}`, row]),
  );

  let transactions: BillingTransaction[] = pageStubs
    .map((stub) => {
      if (stub.source === "purchase_log") {
        const row = purchaseMap.get(`purchase_log:${stub.id}`);
        return row ? mapPurchaseLogToTransaction(row) : null;
      }
      const row = subscriptionMap.get(`subscription_log:${stub.id}`);
      return row ? mapSubscriptionLogToTransaction(row) : null;
    })
    .filter(Boolean) as BillingTransaction[];

  if (filters.status !== "all") {
    transactions = transactions.filter((tx) => tx.status === filters.status);
  }

  const defaultCurrency = getDefaultCurrency();

  const [purchaseSpentAgg, subscriptionSpentAgg, allPurchaseForSummary, allSubscriptionForSummary] =
    await Promise.all([
      prisma.purchaseLog.aggregate({
        where: { user_id: userId, status: "completed" },
        _sum: { amount: true },
      }),
      prisma.subscriptionUpgradeLog.aggregate({
        where: {
          bizcard: { user_id: userId },
          upgrade_type: { in: Array.from(SUBSCRIPTION_PAYMENT_TYPES) },
        },
        _sum: { amount_paid: true },
      }),
      prisma.purchaseLog.findMany({
        where: { user_id: userId },
        select: { purchase_type: true, amount: true, status: true, purchased_at: true },
        orderBy: { purchased_at: "desc" },
      }),
      prisma.subscriptionUpgradeLog.findMany({
        where: { bizcard: { user_id: userId } },
        select: { upgrade_type: true, amount_paid: true, effective_date: true },
        orderBy: { effective_date: "desc" },
      }),
    ]);

  const purchaseSpent = Number(purchaseSpentAgg._sum.amount ?? 0);
  const subscriptionSpent = Number(subscriptionSpentAgg._sum.amount_paid ?? 0);
  const totalSpent = purchaseSpent + subscriptionSpent;

  const byType = {
    subscription: 0,
    physical_card: 0,
    theme: 0,
    promo: 0,
    subscription_change: 0,
  };

  const byStatus: Record<string, number> = {
    completed: 0,
    failed: 0,
    pending: 0,
    refunded: 0,
    scheduled: 0,
    cancelled: 0,
  };

  for (const row of allPurchaseForSummary) {
    const mappedType = mapPurchaseLogType(row.purchase_type);
    const mappedStatus = mapPurchaseLogStatus(row.status);
    if (row.status === "completed") {
      byType[mappedType === "physical_card" ? "physical_card" : mappedType] += Number(row.amount);
      if (mappedType === "physical_card") byType.promo += Number(row.amount);
    }
    byStatus[mappedStatus] = (byStatus[mappedStatus] ?? 0) + 1;
  }

  for (const row of allSubscriptionForSummary) {
    const mappedType = mapSubscriptionLogType(row.upgrade_type);
    const mappedStatus = mapSubscriptionLogStatus(row.upgrade_type);
    const amount = Number(row.amount_paid ?? 0);
    if (mappedStatus === "completed" && amount > 0) {
      byType[mappedType === "subscription_change" ? "subscription_change" : "subscription"] += amount;
    }
    byStatus[mappedStatus] = (byStatus[mappedStatus] ?? 0) + 1;
  }

  const lastPurchaseDate = allPurchaseForSummary[0]?.purchased_at ?? null;
  const lastSubscriptionDate = allSubscriptionForSummary[0]?.effective_date ?? null;
  const lastTransactionDate =
    lastPurchaseDate && lastSubscriptionDate
      ? lastPurchaseDate > lastSubscriptionDate
        ? lastPurchaseDate
        : lastSubscriptionDate
      : lastPurchaseDate ?? lastSubscriptionDate;

  const completedCount =
    (byStatus.completed ?? 0) +
    (byStatus.scheduled ?? 0) +
    (byStatus.cancelled ?? 0);

  return {
    transactions,
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      pages: Math.ceil(total / filters.limit) || 1,
    },
    summary: {
      total_spent: totalSpent,
      total_spent_formatted: formatBillingAmount(totalSpent, defaultCurrency),
      by_type: byType,
      by_status: byStatus,
      average_transaction: completedCount > 0 ? totalSpent / completedCount : 0,
      last_transaction_date: lastTransactionDate,
    },
  };
}

export async function getBillingReceipt(userId: bigint, transactionId: string) {
  const parsed = parseBillingTransactionId(transactionId);
  if (!parsed) return null;

  if (parsed.source === "purchase_log") {
    const purchase = await prisma.purchaseLog.findFirst({
      where: { id: parsed.id, user_id: userId },
      include: {
        user: { select: { first_name: true, last_name: true, email: true } },
        order: { include: { items: true } },
      },
    });
    if (!purchase) return null;

    const currency = resolveCurrency(purchase.order);
    const total = Number(purchase.amount);
    const customerName = `${purchase.user.first_name ?? ""} ${purchase.user.last_name ?? ""}`.trim();

    const items = purchase.order?.items?.length
      ? purchase.order.items.map((item) => ({
          description: item.item_name,
          quantity: item.quantity,
          unit_price: Number(item.unit_price),
          amount: Number(item.total_price),
        }))
      : [
          {
            description: purchase.item_name,
            quantity: 1,
            unit_price: total,
            amount: total,
          },
        ];

    const subtotal = purchase.order ? Number(purchase.order.subtotal) : total;
    const tax = purchase.order ? Number(purchase.order.tax_amount) : 0;
    const shipping = purchase.order ? Number(purchase.order.shipping_amount) : 0;
    const discount = purchase.order ? Number(purchase.order.discount_amount) : 0;
    const orderTotal = purchase.order ? Number(purchase.order.total_amount) : total;

    let billingAddress: unknown = null;
    if (purchase.order?.billing_address) {
      billingAddress = parseJsonSafe(purchase.order.billing_address);
    }

    return {
      kind: "purchase" as const,
      data: {
        receipt_id: `rcpt_${purchase.id}`,
        transaction_id: `txn_${purchase.id}`,
        date: purchase.purchased_at,
        business: {
          name: process.env.BILLING_BUSINESS_NAME ?? "OnTap",
          email: process.env.BILLING_BUSINESS_EMAIL ?? "billing@ontap.ph",
          phone: process.env.BILLING_BUSINESS_PHONE ?? null,
          address: process.env.BILLING_BUSINESS_ADDRESS ?? null,
          tax_id: process.env.BILLING_BUSINESS_TAX_ID ?? null,
        },
        customer: {
          name: customerName || "Customer",
          email: purchase.user.email,
          billing_address: billingAddress,
        },
        order: purchase.order
          ? {
              order_number: purchase.order.order_number,
              subtotal,
              tax,
              shipping,
              discount,
              total: orderTotal,
            }
          : null,
        items,
        subtotal,
        tax,
        shipping,
        discount,
        total: orderTotal,
        currency,
        formatted_total: formatBillingAmount(orderTotal, currency),
        payment_method: {
          type: purchase.order?.payment_method ?? "xendit",
          brand: purchase.order?.xendit_payment_method ?? null,
          last4: null,
        },
        status: purchase.status,
        invoice_number: purchase.order?.order_number ?? `INV-${purchase.id}`,
        metadata: parseJsonSafe(purchase.metadata),
      },
    };
  }

  const subLog = await prisma.subscriptionUpgradeLog.findFirst({
    where: {
      id: parsed.id,
      bizcard: { user_id: userId },
    },
    include: {
      fromPlan: true,
      toPlan: true,
      bizcard: { select: { serial_id: true } },
      order: { include: { items: true } },
    },
  });
  if (!subLog) return null;

  const user = await prisma.user.findUnique({
    where: { user_id: userId },
    select: { first_name: true, last_name: true, email: true },
  });
  if (!user) return null;

  const currency = resolveCurrency(subLog.order);
  const total = Number(subLog.amount_paid ?? 0);
  const description = subscriptionDescription(subLog.upgrade_type, subLog.fromPlan, subLog.toPlan);
  const customerName = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
  const status = mapSubscriptionLogStatus(subLog.upgrade_type);

  return {
    kind: "subscription" as const,
    data: {
      receipt_id: `rcpt_sub_${subLog.id}`,
      transaction_id: `sub_${subLog.id}`,
      event_type: subLog.upgrade_type,
      date: subLog.effective_date,
      status,
      currency,
      total,
      formatted_total: formatBillingAmount(total, currency),
      subscription: {
        bizcard_serial: subLog.bizcard.serial_id,
        billing_cycle: subLog.billing_cycle,
        from_plan: subLog.fromPlan
          ? { id: subLog.fromPlan.id.toString(), name: subLog.fromPlan.name }
          : null,
        to_plan: { id: subLog.toPlan.id.toString(), name: subLog.toPlan.name },
        effective_date: subLog.effective_date,
        expiry_date: subLog.expiry_date,
      },
      customer: {
        name: customerName || "Customer",
        email: user.email,
      },
      items: [
        {
          description,
          quantity: 1,
          unit_price: total,
          amount: total,
        },
      ],
      subtotal: total,
      tax: 0,
      payment_method: { type: "xendit", brand: null, last4: null },
      invoice_number: `INV-SUB-${subLog.id}`,
      order: subLog.order
        ? {
            order_number: subLog.order.order_number,
            total: Number(subLog.order.total_amount),
          }
        : null,
    },
  };
}
