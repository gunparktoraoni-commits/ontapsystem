import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Prisma } from "@prisma/client";
import { AppError } from "@/lib/errors/types";
import { OrderErrorCode, createOrderError } from "@/lib/errors/order-errors";
import { OrderMgmtErrorCode, createOrderMgmtError } from "@/lib/errors/order-mgmt-errors";
import { publishOrderStreamEvent } from "@/lib/orders/order-stream";
import { prisma } from "@/server/lib/prisma";
import { toJsonString } from "@/server/lib/json-field";

export type ManagedOrderStatus =
  | "pending"
  | "paid"
  | "processed"
  | "completed"
  | "cancelled";

type LegacyManagedOrderStatus =
  | "pending_payment"
  | "processing"
  | "shipped"
  | "delivered"
  | "payment_failed"
  | "refunded";

export type ManagedOrderStatusInput = ManagedOrderStatus | LegacyManagedOrderStatus;

export const MANAGED_ORDER_STATUSES: ManagedOrderStatus[] = [
  "pending",
  "paid",
  "processed",
  "completed",
  "cancelled",
];

const LEGACY_STATUS_INPUTS: LegacyManagedOrderStatus[] = [
  "pending_payment",
  "processing",
  "shipped",
  "delivered",
  "payment_failed",
  "refunded",
];

const STATUS_ALIAS_MAP: Record<ManagedOrderStatusInput | "canceled" | "paid", ManagedOrderStatus> = {
  pending: "pending",
  paid: "paid",
  processed: "processed",
  completed: "completed",
  cancelled: "cancelled",
  pending_payment: "pending",
  processing: "processed",
  shipped: "processed",
  delivered: "processed",
  payment_failed: "cancelled",
  refunded: "completed",
  canceled: "cancelled",
};

const STATUS_QUERY_EXPANSION: Record<ManagedOrderStatus, string[]> = {
  pending: ["pending", "pending_payment"],
  paid: ["paid"],
  processed: ["processed", "processing", "shipped", "delivered"],
  completed: ["completed", "refunded"],
  cancelled: ["cancelled", "payment_failed"],
};

export type OrderSortBy = "placed_at" | "total_amount" | "status_changed_at" | "order_number";

export interface OrderListFilters {
  page: number;
  limit: number;
  search?: string;
  status?: ManagedOrderStatus | "all";
  payment_method?: string;
  sort_by?: OrderSortBy;
  sort_dir?: "asc" | "desc";
  start_date?: string;
  end_date?: string;
}

export interface OrderSummaryFilters {
  start_date?: string;
  end_date?: string;
}

export interface OrderAnalyticsFilters {
  start_date?: string;
  end_date?: string;
  status?: ManagedOrderStatus | "all";
}

export interface OrderRecentFilters {
  page: number;
  limit: number;
  days?: number;
  search?: string;
  status?: ManagedOrderStatus | "all";
  payment_method?: string;
}

export interface OrderStatusUpdateInput {
  status: ManagedOrderStatus;
  reason?: string;
  tracking_number?: string;
  tracking_carrier?: string;
  tracking_url?: string;
}

interface OrderActorContext {
  ipAddress?: string;
  userAgent?: string;
}

const MAX_EXPORT_ROWS = 25000;
const MAX_PDF_ROWS = 1500;
const MAX_BULK_UPDATES = 100;
const MAX_RECENT_WINDOW_DAYS = 90;

const STATUS_TRANSITIONS: Record<ManagedOrderStatus, ManagedOrderStatus[]> = {
  pending: ["paid", "processed", "completed", "cancelled"],
  paid: ["processed", "completed", "cancelled"],
  processed: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

function normalizeText(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function toNumber(value: Prisma.Decimal | number | null | undefined): number {
  return Number(value ?? 0);
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function normalizeManagedOrderStatus(
  value: string | null | undefined
): ManagedOrderStatus | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return STATUS_ALIAS_MAP[normalized as keyof typeof STATUS_ALIAS_MAP] ?? null;
}

function expandStatusForQuery(status: ManagedOrderStatus): string[] {
  return STATUS_QUERY_EXPANSION[status];
}

function toStatusOutput(value: string): ManagedOrderStatus {
  return normalizeManagedOrderStatus(value) ?? "pending";
}

function toOrderStatus(value: string, requestId: string): ManagedOrderStatus {
  const normalized = normalizeManagedOrderStatus(value);
  if (normalized) return normalized;

  throw createOrderError(
    OrderErrorCode.INVALID_STATUS,
    "Invalid order status",
    400,
    requestId,
    {
      status: value,
      allowed: MANAGED_ORDER_STATUSES,
      legacy_aliases: LEGACY_STATUS_INPUTS,
    }
  );
}

function parseDateInput(value: string | undefined, fieldName: string, requestId: string): Date {
  if (!value) {
    throw createOrderError(
      OrderErrorCode.INVALID_DATE_RANGE,
      `${fieldName} is required`,
      400,
      requestId,
      { field: fieldName }
    );
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw createOrderError(
      OrderErrorCode.INVALID_DATE_RANGE,
      `${fieldName} must be a valid date`,
      400,
      requestId,
      { field: fieldName, value }
    );
  }

  return parsed;
}

function resolveDateRange(
  requestId: string,
  startDate?: string,
  endDate?: string
): { start: Date; end: Date } | undefined {
  if (!startDate && !endDate) return undefined;

  const start = parseDateInput(startDate, "start_date", requestId);
  const end = parseDateInput(endDate, "end_date", requestId);

  if (start.getTime() > end.getTime()) {
    throw createOrderError(
      OrderErrorCode.INVALID_DATE_RANGE,
      "start_date must be less than or equal to end_date",
      400,
      requestId,
      { start_date: startDate, end_date: endDate }
    );
  }

  return { start, end };
}

function parseAddress(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function escapeCsv(value: unknown): string {
  const stringValue = value == null ? "" : String(value);
  if (stringValue.includes(",") || stringValue.includes("\"") || stringValue.includes("\n")) {
    return `"${stringValue.replace(/\"/g, '""')}"`;
  }
  return stringValue;
}

function canTransition(from: ManagedOrderStatus, to: ManagedOrderStatus): boolean {
  if (from === to) return false;
  return STATUS_TRANSITIONS[from].includes(to);
}

function toListOrderBy(
  sortBy: OrderSortBy | undefined,
  sortDir: "asc" | "desc" | undefined
): Prisma.ShopOrderOrderByWithRelationInput {
  const direction = sortDir ?? "desc";

  if (sortBy === "total_amount") return { total_amount: direction };
  if (sortBy === "status_changed_at") return { status_changed_at: direction };
  if (sortBy === "order_number") return { order_number: direction };
  return { placed_at: direction };
}

function mergeStatusTimestamps(
  current: {
    completed_at: Date | null;
    cancelled_at: Date | null;
    refunded_at: Date | null;
  },
  nextStatus: ManagedOrderStatus,
  now: Date
): Pick<Prisma.ShopOrderUpdateInput, "completed_at" | "cancelled_at" | "refunded_at"> {
  return {
    completed_at: nextStatus === "completed" ? (current.completed_at ?? now) : current.completed_at,
    cancelled_at: nextStatus === "cancelled" ? (current.cancelled_at ?? now) : current.cancelled_at,
    refunded_at: current.refunded_at,
  };
}

export class OrderManagementService {
  private readonly requestId: string;

  constructor(requestId: string) {
    this.requestId = requestId;
  }

  private buildOrderWhere(filters: Omit<OrderListFilters, "page" | "limit">): Prisma.ShopOrderWhereInput {
    const andClauses: Prisma.ShopOrderWhereInput[] = [];
    const search = normalizeText(filters.search);

    if (filters.status && filters.status !== "all") {
      andClauses.push({ status: { in: expandStatusForQuery(filters.status) } });
    }

    if (filters.payment_method) {
      andClauses.push({ payment_method: filters.payment_method });
    }

    const range = resolveDateRange(this.requestId, filters.start_date, filters.end_date);
    if (range) {
      andClauses.push({
        placed_at: {
          gte: range.start,
          lte: range.end,
        },
      });
    }

    if (search) {
      andClauses.push({
        OR: [
          { order_number: { contains: search } },
          { payment_id: { contains: search } },
          { xendit_payment_id: { contains: search } },
          { user: { email: { contains: search } } },
          { user: { first_name: { contains: search } } },
          { user: { last_name: { contains: search } } },
        ],
      });
    }

    if (andClauses.length === 0) return {};
    return { AND: andClauses };
  }

  private async findOrderByIdentifier(orderIdOrNumber: string) {
    const normalized = orderIdOrNumber.trim();

    const where: Prisma.ShopOrderWhereInput = /^\d+$/.test(normalized)
      ? {
          OR: [{ id: BigInt(normalized) }, { order_number: normalized }],
        }
      : { order_number: normalized };

    return prisma.shopOrder.findFirst({
      where,
      include: {
        user: {
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            email: true,
            contact: true,
          },
        },
        items: {
          orderBy: { id: "asc" },
          select: {
            id: true,
            item_type: true,
            item_id: true,
            item_name: true,
            quantity: true,
            unit_price: true,
            total_price: true,
            custom_data: true,
            created_at: true,
          },
        },
      },
    });
  }

  private toOrderListItem(order: {
    id: bigint;
    order_number: string;
    user_id: bigint;
    status: string;
    total_amount: Prisma.Decimal;
    currency: string;
    payment_method: string | null;
    tracking_number: string | null;
    placed_at: Date;
    status_changed_at: Date | null;
    user: {
      first_name: string;
      last_name: string;
      email: string;
    };
    _count: { items: number };
  }) {
    const status = toStatusOutput(order.status);

    return {
      order_id: order.id.toString(),
      order_number: order.order_number,
      user_id: order.user_id.toString(),
      customer_name: `${order.user.first_name} ${order.user.last_name}`.trim(),
      customer_email: order.user.email,
      status,
      total_amount: toNumber(order.total_amount),
      currency: order.currency,
      payment_method: order.payment_method,
      tracking_number: order.tracking_number,
      placed_at: order.placed_at,
      status_changed_at: order.status_changed_at,
      item_count: order._count.items,
      can_update_status: STATUS_TRANSITIONS[status].length > 0,
    };
  }

  async getOrderSummary(filters: OrderSummaryFilters = {}) {
    const range = resolveDateRange(this.requestId, filters.start_date, filters.end_date);

    const where: Prisma.ShopOrderWhereInput = range
      ? {
          placed_at: {
            gte: range.start,
            lte: range.end,
          },
        }
      : {};

    const [totalOrders, grouped] = await Promise.all([
      prisma.shopOrder.count({ where }),
      prisma.shopOrder.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
        _sum: { total_amount: true },
      }),
    ]);

    const byStatus: Record<string, { count: number; revenue: number }> = {};
    for (const status of MANAGED_ORDER_STATUSES) {
      byStatus[status] = { count: 0, revenue: 0 };
    }

    for (const row of grouped) {
      const status = toStatusOutput(row.status);
      byStatus[status].count += row._count._all;
      byStatus[status].revenue += toNumber(row._sum.total_amount);
    }

    // Revenue is only recognized once payment is confirmed. Unpaid / abandoned
    // invoices (pending, pending_payment) and cancelled / failed orders must not
    // inflate revenue or the average order value.
    const revenueStatuses: ManagedOrderStatus[] = ["paid", "processed", "completed"];
    const revenue = revenueStatuses.reduce(
      (sum, status) => sum + (byStatus[status]?.revenue ?? 0),
      0,
    );
    const paidOrderCount = revenueStatuses.reduce(
      (sum, status) => sum + (byStatus[status]?.count ?? 0),
      0,
    );

    return {
      total_orders: totalOrders,
      total_revenue: revenue,
      average_order_value:
        paidOrderCount === 0 ? 0 : Math.round((revenue / paidOrderCount) * 100) / 100,
      by_status: byStatus,
      window: range
        ? {
            start: range.start.toISOString(),
            end: range.end.toISOString(),
          }
        : null,
    };
  }

  async getOrders(filters: OrderListFilters) {
    if (!Number.isInteger(filters.page) || filters.page <= 0) {
      throw createOrderError(
        OrderErrorCode.INVALID_PAGINATION,
        "page must be a positive integer",
        400,
        this.requestId,
        { page: filters.page }
      );
    }

    if (!Number.isInteger(filters.limit) || filters.limit <= 0 || filters.limit > 100) {
      throw createOrderError(
        OrderErrorCode.INVALID_PAGINATION,
        "limit must be between 1 and 100",
        400,
        this.requestId,
        { limit: filters.limit }
      );
    }

    const where = this.buildOrderWhere(filters);
    const page = filters.page;
    const limit = filters.limit;
    const skip = (page - 1) * limit;

    const [total, rows] = await Promise.all([
      prisma.shopOrder.count({ where }),
      prisma.shopOrder.findMany({
        where,
        orderBy: toListOrderBy(filters.sort_by, filters.sort_dir),
        skip,
        take: limit,
        select: {
          id: true,
          order_number: true,
          user_id: true,
          status: true,
          total_amount: true,
          currency: true,
          payment_method: true,
          tracking_number: true,
          placed_at: true,
          status_changed_at: true,
          user: {
            select: {
              first_name: true,
              last_name: true,
              email: true,
            },
          },
          _count: {
            select: {
              items: true,
            },
          },
        },
      }),
    ]);

    const pages = Math.max(1, Math.ceil(total / limit));

    return {
      orders: rows.map((row) => this.toOrderListItem(row)),
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

  async getRecentOrders(filters: OrderRecentFilters) {
    const days = filters.days ?? 14;
    if (!Number.isInteger(days) || days <= 0 || days > MAX_RECENT_WINDOW_DAYS) {
      throw createOrderError(
        OrderErrorCode.INVALID_FILTER,
        `days must be an integer between 1 and ${MAX_RECENT_WINDOW_DAYS}`,
        400,
        this.requestId,
        { days }
      );
    }

    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - days);

    const result = await this.getOrders({
      page: filters.page,
      limit: filters.limit,
      search: filters.search,
      status: filters.status,
      payment_method: filters.payment_method,
      sort_by: "placed_at",
      sort_dir: "desc",
      start_date: start.toISOString(),
      end_date: end.toISOString(),
    });

    return {
      ...result,
      window: {
        days,
        start: start.toISOString(),
        end: end.toISOString(),
      },
    };
  }

  async cancelOrder(
    orderIdOrNumber: string,
    performedBy: string,
    reason?: string,
    context?: OrderActorContext
  ) {
    return this.updateOrderStatus(
      orderIdOrNumber,
      {
        status: "cancelled",
        reason: normalizeText(reason) ?? "Cancelled by superadmin",
      },
      performedBy,
      context
    );
  }

  async getOrderDetail(orderIdOrNumber: string) {
    const order = await this.findOrderByIdentifier(orderIdOrNumber);

    if (!order) {
      throw createOrderError(
        OrderErrorCode.ORDER_NOT_FOUND,
        "Order not found",
        404,
        this.requestId,
        { order: orderIdOrNumber }
      );
    }

    return {
      order_id: order.id.toString(),
      order_number: order.order_number,
      user: {
        user_id: order.user.user_id.toString(),
        first_name: order.user.first_name,
        last_name: order.user.last_name,
        email: order.user.email,
        contact: order.user.contact,
      },
      status: toStatusOutput(order.status),
      status_note: order.status_change_note,
      status_changed_at: order.status_changed_at,
      status_changed_by: order.status_changed_by?.toString() ?? null,
      totals: {
        subtotal: toNumber(order.subtotal),
        discount_amount: toNumber(order.discount_amount),
        tax_amount: toNumber(order.tax_amount),
        shipping_amount: toNumber(order.shipping_amount),
        total_amount: toNumber(order.total_amount),
        currency: order.currency,
      },
      payment: {
        payment_method: order.payment_method,
        payment_id: order.payment_id,
        xendit_payment_id: order.xendit_payment_id,
        xendit_status: order.xendit_status,
        xendit_invoice_url: order.xendit_invoice_url,
      },
      shipment: {
        tracking_number: order.tracking_number,
        tracking_carrier: order.tracking_carrier,
        tracking_url: order.tracking_url,
      },
      addresses: {
        shipping: parseAddress(order.shipping_address),
        billing: parseAddress(order.billing_address),
      },
      notes: order.notes,
      placed_at: order.placed_at,
      completed_at: order.completed_at,
      cancelled_at: order.cancelled_at,
      refunded_at: order.refunded_at,
      items: order.items.map((item) => ({
        item_id: item.id.toString(),
        item_type: item.item_type,
        item_ref_id: item.item_id.toString(),
        item_name: item.item_name,
        quantity: item.quantity,
        unit_price: toNumber(item.unit_price),
        total_price: toNumber(item.total_price),
        custom_data: item.custom_data,
        created_at: item.created_at,
      })),
    };
  }

  async getOrderTimeline(orderIdOrNumber: string) {
    const order = await prisma.shopOrder.findFirst({
      where: /^\d+$/.test(orderIdOrNumber.trim())
        ? {
            OR: [{ id: BigInt(orderIdOrNumber.trim()) }, { order_number: orderIdOrNumber.trim() }],
          }
        : { order_number: orderIdOrNumber.trim() },
      select: {
        id: true,
        order_number: true,
        status: true,
        placed_at: true,
        completed_at: true,
        cancelled_at: true,
        refunded_at: true,
      },
    });

    if (!order) {
      throw createOrderError(
        OrderErrorCode.ORDER_NOT_FOUND,
        "Order not found",
        404,
        this.requestId,
        { order: orderIdOrNumber }
      );
    }

    const audits = await prisma.orderStatusAuditLog.findMany({
      where: { order_id: order.id },
      orderBy: { changed_at: "asc" },
      select: {
        log_id: true,
        previous_status: true,
        next_status: true,
        reason: true,
        changed_at: true,
        actor: {
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            email: true,
          },
        },
      },
    });

    const timeline: Array<{
      event_id: string;
      event: string;
      previous_status: string | null;
      next_status: string;
      reason: string | null;
      changed_at: Date;
      actor: {
        user_id: string;
        name: string;
        email: string;
      } | null;
    }> = [
      {
        event_id: `placed-${order.id.toString()}`,
        event: "ORDER_PLACED",
        previous_status: null,
        next_status: "pending",
        reason: null,
        changed_at: order.placed_at,
        actor: null,
      },
    ];

    for (const row of audits) {
      const previousStatus = row.previous_status
        ? normalizeManagedOrderStatus(row.previous_status) ?? row.previous_status
        : null;
      const nextStatus = normalizeManagedOrderStatus(row.next_status) ?? row.next_status;

      timeline.push({
        event_id: row.log_id.toString(),
        event: "STATUS_UPDATED",
        previous_status: previousStatus,
        next_status: nextStatus,
        reason: row.reason,
        changed_at: row.changed_at,
        actor: {
          user_id: row.actor.user_id.toString(),
          name: `${row.actor.first_name} ${row.actor.last_name}`.trim(),
          email: row.actor.email,
        },
      });
    }

    timeline.sort((a, b) => a.changed_at.getTime() - b.changed_at.getTime());

    return {
      order_id: order.id.toString(),
      order_number: order.order_number,
      current_status: toStatusOutput(order.status),
      timeline,
    };
  }

  async updateOrderStatus(
    orderIdOrNumber: string,
    input: OrderStatusUpdateInput,
    performedBy: string,
    context?: OrderActorContext
  ) {
    const nextStatus = toOrderStatus(input.status, this.requestId);
    const actorId = BigInt(performedBy);

    const existing = await prisma.shopOrder.findFirst({
      where: /^\d+$/.test(orderIdOrNumber.trim())
        ? {
            OR: [{ id: BigInt(orderIdOrNumber.trim()) }, { order_number: orderIdOrNumber.trim() }],
          }
        : { order_number: orderIdOrNumber.trim() },
      select: {
        id: true,
        order_number: true,
        user_id: true,
        status: true,
        completed_at: true,
        cancelled_at: true,
        refunded_at: true,
        placed_at: true,
        total_amount: true,
        currency: true,
        tracking_number: true,
        tracking_carrier: true,
        tracking_url: true,
      },
    });

    if (!existing) {
      throw createOrderError(
        OrderErrorCode.ORDER_NOT_FOUND,
        "Order not found",
        404,
        this.requestId,
        { order: orderIdOrNumber }
      );
    }

    const currentStatus = toOrderStatus(existing.status, this.requestId);

    if (currentStatus === nextStatus) {
      throw createOrderError(
        OrderErrorCode.ORDER_ALREADY_IN_STATUS,
        `Order is already in status '${nextStatus}'`,
        409,
        this.requestId,
        { order_id: existing.id.toString(), status: nextStatus }
      );
    }

    if (!canTransition(currentStatus, nextStatus)) {
      throw createOrderError(
        OrderErrorCode.ORDER_STATUS_TRANSITION_INVALID,
        `Cannot transition order status from '${currentStatus}' to '${nextStatus}'`,
        409,
        this.requestId,
        { from: currentStatus, to: nextStatus }
      );
    }

    const now = new Date();
    const reason = normalizeText(input.reason);

    const timestamps = mergeStatusTimestamps(existing, nextStatus, now);

    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.shopOrder.update({
        where: { id: existing.id },
        data: {
          status: nextStatus,
          status_changed_at: now,
          status_changed_by: actorId,
          status_change_note: reason ?? null,
          tracking_number: input.tracking_number ?? existing.tracking_number,
          tracking_carrier: input.tracking_carrier ?? existing.tracking_carrier,
          tracking_url: input.tracking_url ?? existing.tracking_url,
          completed_at: timestamps.completed_at,
          cancelled_at: timestamps.cancelled_at,
          refunded_at: timestamps.refunded_at,
        },
      });

      await tx.orderStatusAuditLog.create({
        data: {
          order_id: existing.id,
          previous_status: currentStatus,
          next_status: nextStatus,
          reason: reason ?? null,
          changed_by: actorId,
          request_id: this.requestId,
          ip_address: context?.ipAddress ?? null,
          user_agent: context?.userAgent ?? null,
          metadata: toJsonString({
            tracking_number: input.tracking_number,
            tracking_carrier: input.tracking_carrier,
            tracking_url: input.tracking_url,
          }),
        },
      });

      await tx.orderStatusCache.upsert({
        where: { order_id: existing.id },
        create: {
          order_id: existing.id,
          order_number: existing.order_number,
          user_id: existing.user_id,
          status: nextStatus,
          previous_status: currentStatus,
          status_changed_at: now,
          placed_at: existing.placed_at,
          completed_at: order.completed_at,
          cancelled_at: order.cancelled_at,
          refunded_at: order.refunded_at,
          total_amount: existing.total_amount,
          currency: existing.currency,
          updated_at: now,
        },
        update: {
          status: nextStatus,
          previous_status: currentStatus,
          status_changed_at: now,
          completed_at: order.completed_at,
          cancelled_at: order.cancelled_at,
          refunded_at: order.refunded_at,
          total_amount: existing.total_amount,
          currency: existing.currency,
          updated_at: now,
        },
      });

      return order;
    });

    publishOrderStreamEvent({
      orderId: existing.id.toString(),
      orderNumber: existing.order_number,
      status: toStatusOutput(updated.status),
      previousStatus: currentStatus,
      changedBy: actorId.toString(),
      changedAt: now.toISOString(),
      metadata: {
        requestId: this.requestId,
        reason: reason ?? null,
      },
    });

    return {
      order_id: updated.id.toString(),
      order_number: updated.order_number,
      previous_status: currentStatus,
      status: toStatusOutput(updated.status),
      status_changed_at: updated.status_changed_at,
      status_changed_by: updated.status_changed_by?.toString() ?? null,
      tracking_number: updated.tracking_number,
      tracking_carrier: updated.tracking_carrier,
      tracking_url: updated.tracking_url,
      completed_at: updated.completed_at,
      cancelled_at: updated.cancelled_at,
      refunded_at: updated.refunded_at,
    };
  }

  async bulkUpdateOrderStatus(
    orderIds: string[],
    input: OrderStatusUpdateInput,
    performedBy: string,
    context?: OrderActorContext
  ) {
    const normalizedIds = [...new Set(orderIds.map((value) => value.trim()).filter(Boolean))];

    if (normalizedIds.length === 0) {
      throw createOrderError(
        OrderErrorCode.INVALID_REQUEST_BODY,
        "order_ids must contain at least one order identifier",
        400,
        this.requestId
      );
    }

    if (normalizedIds.length > MAX_BULK_UPDATES) {
      throw createOrderError(
        OrderErrorCode.INVALID_REQUEST_BODY,
        `order_ids cannot exceed ${MAX_BULK_UPDATES} per request`,
        400,
        this.requestId,
        { max: MAX_BULK_UPDATES }
      );
    }

    const results: Array<{
      order: string;
      success: boolean;
      status?: string;
      error?: string;
      code?: OrderErrorCode;
    }> = [];

    for (const orderId of normalizedIds) {
      try {
        const updated = await this.updateOrderStatus(orderId, input, performedBy, context);
        results.push({
          order: orderId,
          success: true,
          status: updated.status,
        });
      } catch (error) {
        if (error instanceof AppError) {
          results.push({
            order: orderId,
            success: false,
            error: error.message,
            code: String(error.code) as OrderErrorCode,
          });
          continue;
        }

        results.push({
          order: orderId,
          success: false,
          error: "Unexpected error",
          code: OrderErrorCode.INTERNAL_ERROR,
        });
      }
    }

    const updatedCount = results.filter((item) => item.success).length;

    return {
      total_requested: normalizedIds.length,
      updated_count: updatedCount,
      failed_count: normalizedIds.length - updatedCount,
      results,
    };
  }

  async deleteOrders(orderIds: string[], performedBy: string) {
    const normalizedIds = [...new Set(orderIds.map((value) => value.trim()).filter(Boolean))];

    if (normalizedIds.length === 0) {
      throw createOrderError(
        OrderErrorCode.INVALID_REQUEST_BODY,
        "order_ids must contain at least one order identifier",
        400,
        this.requestId
      );
    }

    if (normalizedIds.length > MAX_BULK_UPDATES) {
      throw createOrderError(
        OrderErrorCode.INVALID_REQUEST_BODY,
        `order_ids cannot exceed ${MAX_BULK_UPDATES} per request`,
        400,
        this.requestId,
        { max: MAX_BULK_UPDATES }
      );
    }

    const numericIds = normalizedIds.filter((value) => /^\d+$/.test(value)).map((value) => BigInt(value));
    const orders = await prisma.shopOrder.findMany({
      where: {
        OR: [
          ...(numericIds.length > 0 ? [{ id: { in: numericIds } }] : []),
          { order_number: { in: normalizedIds } },
        ],
      },
      select: {
        id: true,
        order_number: true,
        user_id: true,
        status: true,
        total_amount: true,
      },
    });

    if (orders.length === 0) {
      throw createOrderError(
        OrderErrorCode.ORDER_NOT_FOUND,
        "No matching orders found for deletion",
        404,
        this.requestId,
        { order_ids: normalizedIds }
      );
    }

    const ids = orders.map((order) => order.id);

    await prisma.$transaction(async (tx) => {
      await tx.purchaseLog.updateMany({
        where: { order_id: { in: ids } },
        data: { order_id: null },
      });
      await tx.templatePurchase.updateMany({
        where: { order_id: { in: ids } },
        data: { order_id: null },
      });
      await tx.spinHistory.updateMany({
        where: { order_id: { in: ids } },
        data: { order_id: null },
      });
      await tx.subscriptionUpgradeLog.updateMany({
        where: { order_id: { in: ids } },
        data: { order_id: null },
      });
      await tx.checkoutSession.updateMany({
        where: { order_id: { in: ids } },
        data: { order_id: null },
      });
      await tx.shopOrder.deleteMany({
        where: { id: { in: ids } },
      });
    });

    for (const order of orders) {
      try {
        publishOrderStreamEvent({
          orderId: order.id.toString(),
          orderNumber: order.order_number,
          status: "deleted",
          previousStatus: order.status,
          changedBy: performedBy,
          changedAt: new Date().toISOString(),
          metadata: { action: "ORDER_DELETED" },
        });
      } catch {
        // Stream publish is best-effort for deletes.
      }
    }

    return {
      total_requested: normalizedIds.length,
      deleted_count: orders.length,
      deleted_orders: orders.map((order) => ({
        order_id: order.id.toString(),
        order_number: order.order_number,
      })),
    };
  }

  async getOrderAnalytics(filters: OrderAnalyticsFilters = {}) {
    const range = resolveDateRange(this.requestId, filters.start_date, filters.end_date);

    const where: Prisma.ShopOrderWhereInput = {
      ...(range
        ? {
            placed_at: {
              gte: range.start,
              lte: range.end,
            },
          }
        : {}),
      ...(filters.status && filters.status !== "all"
        ? { status: { in: expandStatusForQuery(filters.status) } }
        : {}),
    };

    const [totals, byStatus, byPayment, topCustomerGroups] = await Promise.all([
      prisma.shopOrder.aggregate({
        where,
        _count: { _all: true },
        _sum: {
          total_amount: true,
        },
      }),
      prisma.shopOrder.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
        _sum: { total_amount: true },
      }),
      prisma.shopOrder.groupBy({
        by: ["payment_method"],
        where,
        _count: { _all: true },
        _sum: { total_amount: true },
      }),
      prisma.shopOrder.groupBy({
        by: ["user_id"],
        where,
        _count: { _all: true },
        _sum: { total_amount: true },
        orderBy: {
          _sum: {
            total_amount: "desc",
          },
        },
        take: 5,
      }),
    ]);

    const topCustomerIds = topCustomerGroups.map((row) => row.user_id);
    const users = topCustomerIds.length
      ? await prisma.user.findMany({
          where: { user_id: { in: topCustomerIds } },
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            email: true,
          },
        })
      : [];

    const userMap = new Map(users.map((user) => [user.user_id.toString(), user]));

    const trendRows = await prisma.$queryRaw<Array<{
      order_date: Date;
      order_count: bigint;
      revenue: Prisma.Decimal | null;
    }>>(Prisma.sql`
      SELECT
        DATE(o.placed_at) AS order_date,
        COUNT(*) AS order_count,
        SUM(o.total_amount) AS revenue
      FROM ShopOrder o
      ${range
        ? Prisma.sql`WHERE o.placed_at >= ${range.start} AND o.placed_at <= ${range.end}`
        : Prisma.sql``}
      GROUP BY DATE(o.placed_at)
      ORDER BY DATE(o.placed_at) ASC
      LIMIT 90
    `);

    const byStatusSummary: Record<ManagedOrderStatus, { count: number; revenue: number }> = {
      pending: { count: 0, revenue: 0 },
      paid: { count: 0, revenue: 0 },
      processed: { count: 0, revenue: 0 },
      completed: { count: 0, revenue: 0 },
      cancelled: { count: 0, revenue: 0 },
    };

    for (const row of byStatus) {
      const status = toStatusOutput(row.status);
      byStatusSummary[status].count += row._count._all;
      byStatusSummary[status].revenue += toNumber(row._sum.total_amount);
    }

    return {
      totals: {
        total_orders: totals._count._all,
        total_revenue: toNumber(totals._sum.total_amount),
      },
      by_status: MANAGED_ORDER_STATUSES.map((status) => ({
        status,
        count: byStatusSummary[status].count,
        revenue: byStatusSummary[status].revenue,
      })),
      by_payment_method: byPayment.map((row) => ({
        payment_method: row.payment_method ?? "unknown",
        count: row._count._all,
        revenue: toNumber(row._sum.total_amount),
      })),
      top_customers: topCustomerGroups.map((row) => {
        const user = userMap.get(row.user_id.toString());
        return {
          user_id: row.user_id.toString(),
          name: user ? `${user.first_name} ${user.last_name}`.trim() : "Unknown User",
          email: user?.email ?? null,
          order_count: row._count._all,
          revenue: toNumber(row._sum.total_amount),
        };
      }),
      trend: trendRows.map((row) => ({
        order_date: row.order_date.toISOString().slice(0, 10),
        order_count: Number(row.order_count),
        revenue: toNumber(row.revenue),
      })),
      window: range
        ? {
            start: range.start.toISOString(),
            end: range.end.toISOString(),
          }
        : null,
    };
  }

  async exportOrders(
    filters: Omit<OrderListFilters, "page" | "limit">,
    format: "csv" | "xlsx" = "csv"
  ): Promise<Buffer> {
    try {
      const where = this.buildOrderWhere(filters);

      const total = await prisma.shopOrder.count({ where });
      if (total > MAX_EXPORT_ROWS) {
        throw createOrderError(
          OrderErrorCode.EXPORT_TOO_LARGE,
          `Export exceeds maximum row limit (${MAX_EXPORT_ROWS})`,
          413,
          this.requestId,
          { total, maxRows: MAX_EXPORT_ROWS }
        );
      }

      const rows = await prisma.shopOrder.findMany({
        where,
        orderBy: { placed_at: "desc" },
        select: {
          id: true,
          order_number: true,
          user_id: true,
          status: true,
          total_amount: true,
          currency: true,
          payment_method: true,
          tracking_number: true,
          tracking_carrier: true,
          tracking_url: true,
          placed_at: true,
          status_changed_at: true,
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
        },
      });

      const exportRows = rows.map((row) => ({
        order_id: row.id.toString(),
        order_number: row.order_number,
        user_id: row.user_id.toString(),
        customer_name: `${row.user.first_name} ${row.user.last_name}`.trim(),
        customer_email: row.user.email,
        status: toStatusOutput(row.status),
        total_amount: toNumber(row.total_amount),
        currency: row.currency,
        payment_method: row.payment_method ?? "",
        tracking_number: row.tracking_number ?? "",
        tracking_carrier: row.tracking_carrier ?? "",
        tracking_url: row.tracking_url ?? "",
        placed_at: row.placed_at.toISOString(),
        status_changed_at: row.status_changed_at ? row.status_changed_at.toISOString() : "",
        completed_at: row.completed_at ? row.completed_at.toISOString() : "",
        cancelled_at: row.cancelled_at ? row.cancelled_at.toISOString() : "",
        refunded_at: row.refunded_at ? row.refunded_at.toISOString() : "",
      }));

      if (format === "xlsx") {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("Orders");

        worksheet.columns = [
          { header: "Order ID", key: "order_id", width: 18 },
          { header: "Order Number", key: "order_number", width: 24 },
          { header: "User ID", key: "user_id", width: 18 },
          { header: "Customer Name", key: "customer_name", width: 26 },
          { header: "Customer Email", key: "customer_email", width: 32 },
          { header: "Status", key: "status", width: 18 },
          { header: "Total Amount", key: "total_amount", width: 16 },
          { header: "Currency", key: "currency", width: 12 },
          { header: "Payment Method", key: "payment_method", width: 18 },
          { header: "Tracking Number", key: "tracking_number", width: 24 },
          { header: "Tracking Carrier", key: "tracking_carrier", width: 20 },
          { header: "Tracking URL", key: "tracking_url", width: 36 },
          { header: "Placed At", key: "placed_at", width: 28 },
          { header: "Status Changed At", key: "status_changed_at", width: 28 },
          { header: "Completed At", key: "completed_at", width: 28 },
          { header: "Cancelled At", key: "cancelled_at", width: 28 },
          { header: "Refunded At", key: "refunded_at", width: 28 },
        ];

        for (const row of exportRows) {
          worksheet.addRow(row);
        }

        const workbookBuffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(workbookBuffer as ArrayBuffer);
      }

      const headers = [
        "Order ID",
        "Order Number",
        "User ID",
        "Customer Name",
        "Customer Email",
        "Status",
        "Total Amount",
        "Currency",
        "Payment Method",
        "Tracking Number",
        "Tracking Carrier",
        "Tracking URL",
        "Placed At",
        "Status Changed At",
        "Completed At",
        "Cancelled At",
        "Refunded At",
      ];

      const csvLines = [
        headers.join(","),
        ...exportRows.map((row) =>
          [
            row.order_id,
            row.order_number,
            row.user_id,
            row.customer_name,
            row.customer_email,
            row.status,
            row.total_amount,
            row.currency,
            row.payment_method,
            row.tracking_number,
            row.tracking_carrier,
            row.tracking_url,
            row.placed_at,
            row.status_changed_at,
            row.completed_at,
            row.cancelled_at,
            row.refunded_at,
          ]
            .map(escapeCsv)
            .join(",")
        ),
      ];

      return Buffer.from(csvLines.join("\n"), "utf8");
    } catch (error) {
      if (error instanceof AppError) throw error;

      throw createOrderError(
        OrderErrorCode.EXPORT_GENERATION_FAILED,
        "Failed to generate order export",
        500,
        this.requestId
      );
    }
  }

  async generatePdfReport(
    filters: Omit<OrderListFilters, "page" | "limit">
  ): Promise<Buffer> {
    try {
      const where = this.buildOrderWhere(filters);
      const total = await prisma.shopOrder.count({ where });

      if (total > MAX_PDF_ROWS) {
        throw createOrderMgmtError(
          OrderMgmtErrorCode.PDF_REPORT_TOO_LARGE,
          `PDF report exceeds maximum row limit (${MAX_PDF_ROWS})`,
          413,
          this.requestId,
          { total, maxRows: MAX_PDF_ROWS }
        );
      }

      const [rows, totals, grouped] = await Promise.all([
        prisma.shopOrder.findMany({
          where,
          orderBy: { placed_at: "desc" },
          take: MAX_PDF_ROWS,
          select: {
            id: true,
            order_number: true,
            status: true,
            total_amount: true,
            currency: true,
            placed_at: true,
            user: {
              select: {
                first_name: true,
                last_name: true,
                email: true,
              },
            },
          },
        }),
        prisma.shopOrder.aggregate({
          where,
          _sum: {
            total_amount: true,
          },
        }),
        prisma.shopOrder.groupBy({
          by: ["status"],
          where,
          _count: { _all: true },
        }),
      ]);

      const totalRevenue = toNumber(totals._sum.total_amount);
      const averageOrderValue = total === 0 ? 0 : Math.round((totalRevenue / total) * 100) / 100;

      const byStatusSummary: Record<ManagedOrderStatus, number> = {
        pending: 0,
        paid: 0,
        processed: 0,
        completed: 0,
        cancelled: 0,
      };

      for (const row of grouped) {
        const status = toStatusOutput(row.status);
        byStatusSummary[status] += row._count._all;
      }

      const pdf = await PDFDocument.create();
      const regularFont = await pdf.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

      const pageSize: [number, number] = [842, 595];
      const marginX = 36;
      const marginBottom = 36;
      const pageWidth = pageSize[0];
      const pageTop = pageSize[1] - 36;
      let page = pdf.addPage(pageSize);
      let y = pageTop;

      const drawText = (
        text: string,
        options?: { x?: number; size?: number; bold?: boolean; lineHeight?: number }
      ) => {
        page.drawText(text, {
          x: options?.x ?? marginX,
          y,
          size: options?.size ?? 10,
          font: options?.bold ? boldFont : regularFont,
          color: rgb(0, 0, 0),
        });
        y -= options?.lineHeight ?? 14;
      };

      const ensureSpace = (requiredHeight: number, includeTableHeader = false) => {
        if (y - requiredHeight >= marginBottom) return;
        page = pdf.addPage(pageSize);
        y = pageTop;
        if (includeTableHeader) {
          drawTableHeader();
        }
      };

      const drawTableHeader = () => {
        ensureSpace(24);
        page.drawText("Order #", { x: marginX, y, size: 10, font: boldFont, color: rgb(0, 0, 0) });
        page.drawText("Customer", { x: 185, y, size: 10, font: boldFont, color: rgb(0, 0, 0) });
        page.drawText("Status", { x: 460, y, size: 10, font: boldFont, color: rgb(0, 0, 0) });
        page.drawText("Amount", { x: 545, y, size: 10, font: boldFont, color: rgb(0, 0, 0) });
        page.drawText("Placed At", { x: 660, y, size: 10, font: boldFont, color: rgb(0, 0, 0) });
        page.drawLine({
          start: { x: marginX, y: y - 3 },
          end: { x: pageWidth - marginX, y: y - 3 },
          thickness: 0.75,
          color: rgb(0.2, 0.2, 0.2),
        });
        y -= 16;
      };

      drawText("Order Management V2 Report", { size: 16, bold: true, lineHeight: 22 });
      drawText(`Generated At: ${new Date().toISOString()}`, { size: 10 });
      drawText(`Request ID: ${this.requestId}`, { size: 10 });
      drawText("", { lineHeight: 8 });

      drawText(
        `Filters: status=${filters.status ?? "all"} | payment_method=${filters.payment_method ?? "all"} | search=${filters.search ? truncateText(filters.search, 40) : "-"}`,
        { size: 9 }
      );
      drawText(
        `Date range: start=${filters.start_date ?? "-"} | end=${filters.end_date ?? "-"}`,
        { size: 9 }
      );
      drawText("", { lineHeight: 8 });

      drawText(
        `Summary: total_orders=${total} | total_revenue=${totalRevenue.toFixed(2)} | average_order_value=${averageOrderValue.toFixed(2)}`,
        { size: 10, bold: true }
      );
      drawText(
        `Status breakdown: ${MANAGED_ORDER_STATUSES.map((status) => `${status}=${byStatusSummary[status]}`).join(" | ")}`,
        { size: 10 }
      );
      drawText("", { lineHeight: 10 });

      drawTableHeader();

      for (const row of rows) {
        ensureSpace(16, true);

        const customer = truncateText(
          `${row.user.first_name} ${row.user.last_name}`.trim() || row.user.email,
          46
        );
        const status = toStatusOutput(row.status);
        const amount = `${row.currency} ${toNumber(row.total_amount).toFixed(2)}`;
        const placedAt = row.placed_at.toISOString().slice(0, 19).replace("T", " ");

        page.drawText(truncateText(row.order_number, 22), {
          x: marginX,
          y,
          size: 9,
          font: regularFont,
          color: rgb(0, 0, 0),
        });
        page.drawText(customer, {
          x: 185,
          y,
          size: 9,
          font: regularFont,
          color: rgb(0, 0, 0),
        });
        page.drawText(status, {
          x: 460,
          y,
          size: 9,
          font: regularFont,
          color: rgb(0, 0, 0),
        });
        page.drawText(truncateText(amount, 14), {
          x: 545,
          y,
          size: 9,
          font: regularFont,
          color: rgb(0, 0, 0),
        });
        page.drawText(placedAt, {
          x: 660,
          y,
          size: 9,
          font: regularFont,
          color: rgb(0, 0, 0),
        });

        y -= 13;
      }

      const bytes = await pdf.save();
      return Buffer.from(bytes);
    } catch (error) {
      if (error instanceof AppError) throw error;

      throw createOrderMgmtError(
        OrderMgmtErrorCode.PDF_REPORT_GENERATION_FAILED,
        "Failed to generate PDF report",
        500,
        this.requestId
      );
    }
  }

  async getStreamSnapshot(status?: ManagedOrderStatus | "all") {
    const where: Prisma.ShopOrderWhereInput =
      status && status !== "all"
        ? {
            status: { in: expandStatusForQuery(status) },
          }
        : {};

    const [summary, latest] = await Promise.all([
      prisma.shopOrder.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
      }),
      prisma.shopOrder.findMany({
        where,
        orderBy: [{ status_changed_at: "desc" }, { placed_at: "desc" }],
        take: 25,
        select: {
          id: true,
          order_number: true,
          status: true,
          status_changed_at: true,
          placed_at: true,
        },
      }),
    ]);

    const summaryByStatus: Record<ManagedOrderStatus, number> = {
      pending: 0,
      paid: 0,
      processed: 0,
      completed: 0,
      cancelled: 0,
    };

    for (const row of summary) {
      const mappedStatus = toStatusOutput(row.status);
      summaryByStatus[mappedStatus] += row._count._all;
    }

    return {
      summary: MANAGED_ORDER_STATUSES.map((currentStatus) => ({
        status: currentStatus,
        count: summaryByStatus[currentStatus],
      })),
      latest: latest.map((row) => ({
        order_id: row.id.toString(),
        order_number: row.order_number,
        status: toStatusOutput(row.status),
        previous_status: null,
        status_changed_at: row.status_changed_at,
        updated_at: row.status_changed_at ?? row.placed_at,
      })),
    };
  }
}
