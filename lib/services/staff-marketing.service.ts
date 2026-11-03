import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { SupportMessagingService } from "@/lib/services/support-messaging.service";
import {
  StaffMarketingErrorCode,
  createStaffMarketingError,
} from "@/lib/errors/staff-marketing-errors";
import { OrderManagementService } from "@/lib/services/order-management.service";

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const MAX_EXPORT_ROWS = 25_000;
const DATE_FILTERS = ["today", "yesterday", "this_week", "this_month", "custom"] as const;

export type DateFilterType = (typeof DATE_FILTERS)[number];

// ──────────────────────────────────────────────────────────────
// Interfaces & Types
// ──────────────────────────────────────────────────────────────

export interface StaffMarketingClient {
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  company_id: string | null;
  company_name: string | null;
  assigned_at: string; // ISO string
  is_primary: boolean;
  is_active: boolean;
  last_contact?: string; // ISO string or null
  unread_inquiries: number;
  recent_order_count: number;
  card_count: number;
}
export interface DashboardSummary {
  total_assigned_clients: number;
  active_clients: number;
  unread_inquiries: number;
  new_inquiries_today: number;
  total_orders: number;
  orders_pending: number;
  total_messages: number;
  unread_messages: number;
}

export interface ClientInquiry {
  inquiry_id: string;
  sender_user_id: string | null;
  visitor_name: string | null;
  visitor_email: string | null;
  subject: string | null;
  message: string;
  status: string;
  created_at: string; // ISO string
  updated_at: string | null;
  assigned_to_staff_id: string | null;
}

export interface ClientOrder {
  shop_order_id: string;
  order_number: string;
  user_id: string;
  company_id: string | null;
  client_name: string;
  transaction: string;
  quantity: number;
  total_amount: string;
  status: string;
  created_at: string;
  updated_at: string | null;
}

export interface StaffClientOrderDetail {
  order_id: string;
  order_number: string;
  user: {
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
    contact: string | null;
  };
  status: string;
  status_note: string | null;
  status_changed_at: Date | null;
  status_changed_by: string | null;
  totals: {
    subtotal: number;
    discount_amount: number;
    tax_amount: number;
    shipping_amount: number;
    total_amount: number;
    currency: string;
  };
  payment: {
    payment_method: string | null;
    payment_id: string | null;
    xendit_payment_id: string | null;
    xendit_status: string | null;
    xendit_invoice_url: string | null;
  };
  shipment: {
    tracking_number: string | null;
    tracking_carrier: string | null;
    tracking_url: string | null;
  };
  addresses: {
    shipping: Record<string, unknown> | null;
    billing: Record<string, unknown> | null;
  };
  notes: string | null;
  placed_at: Date;
  completed_at: Date | null;
  cancelled_at: Date | null;
  refunded_at: Date | null;
  items: Array<{
    item_id: string;
    item_type: string;
    item_ref_id: string;
    item_name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    custom_data: string | null;
    created_at: Date;
  }>;
}

export interface StaffClientOrderTimeline {
  order_id: string;
  order_number: string;
  current_status: string;
  timeline: Array<{
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
  }>;
}

export type StaffOrderColumn =
  | "pending"
  | "processed"
  | "ready_for_pickup"
  | "completed"
  | "cancelled";

export const STAFF_ORDER_COLUMNS: StaffOrderColumn[] = [
  "pending",
  "processed",
  "ready_for_pickup",
  "completed",
  "cancelled",
];

const STAFF_STATUS_COLUMN_MAP: Record<StaffOrderColumn, string[]> = {
  // "paid" ("Payment Completed") orders are awaiting fulfillment -> New Orders.
  pending: ["pending", "pending_payment", "paid"],
  processed: ["processed", "processing", "shipped"],
  ready_for_pickup: ["ready_for_pickup"],
  completed: ["completed", "delivered", "refunded"],
  cancelled: ["cancelled", "payment_failed", "canceled"],
};

const COLUMN_CANONICAL_STATUS: Record<StaffOrderColumn, string> = {
  pending: "pending",
  processed: "processed",
  ready_for_pickup: "ready_for_pickup",
  completed: "completed",
  cancelled: "cancelled",
};

const STAFF_COLUMN_TRANSITIONS: Record<StaffOrderColumn, StaffOrderColumn[]> = {
  pending: ["processed", "cancelled"],
  processed: ["ready_for_pickup", "completed", "cancelled"],
  ready_for_pickup: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function normalizeOrderToColumn(status: string): StaffOrderColumn {
  for (const column of STAFF_ORDER_COLUMNS) {
    if (STAFF_STATUS_COLUMN_MAP[column].includes(status)) {
      return column;
    }
  }
  return "pending";
}

export function canStaffColumnTransition(
  fromStatus: string,
  toColumn: StaffOrderColumn,
): boolean {
  const fromColumn = normalizeOrderToColumn(fromStatus);
  if (fromColumn === toColumn) return false;
  return STAFF_COLUMN_TRANSITIONS[fromColumn].includes(toColumn);
}

export function getStatusesForColumn(column: StaffOrderColumn): string[] {
  return STAFF_STATUS_COLUMN_MAP[column];
}

export interface MessagingClient {
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  unread_message_count: number;
  last_message_at: string | null; // ISO string
}

export interface StaffMarketingListFilters {
  page?: number;
  limit?: number;
  search?: string;
  status?: "all" | "active" | "inactive";
  date_filter?: DateFilterType;
}

export interface StaffOrderListFilters {
  page?: number;
  limit?: number;
  search?: string;
  status?: "all" | StaffOrderColumn;
  date_filter?: DateFilterType;
}

export interface ClientInquiryFilters {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  date_filter?: DateFilterType;
}

// ──────────────────────────────────────────────────────────────
// Helper Functions
// ──────────────────────────────────────────────────────────────

function toNumber(value: bigint): number {
  return Number(value);
}

function normalizeText(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parsePage(page: number | undefined, requestId: string): number {
  const normalized = page ?? 1;
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw createStaffMarketingError(
      StaffMarketingErrorCode.INVALID_FILTER_TYPE,
      "page must be a positive integer",
      400,
      requestId,
      { page: normalized }
    );
  }
  return normalized;
}

function parseLimit(limit: number | undefined, requestId: string): number {
  const normalized = limit ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(normalized) || normalized <= 0 || normalized > MAX_PAGE_SIZE) {
    throw createStaffMarketingError(
      StaffMarketingErrorCode.INVALID_FILTER_TYPE,
      `limit must be between 1 and ${MAX_PAGE_SIZE}`,
      400,
      requestId,
      { limit: normalized }
    );
  }
  return normalized;
}

function isDateFilter(value: string): value is DateFilterType {
  return (DATE_FILTERS as readonly string[]).includes(value);
}

function getDateRangeFromFilter(filter: DateFilterType): { gte: Date; lte: Date } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  
  switch (filter) {
    case "today":
      return { gte: today, lte: tomorrow };
    case "yesterday": {
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      return { gte: yesterday, lte: today };
    }
    case "this_week": {
      const dayOfWeek = today.getDay();
      const weekStart = new Date(today.getTime() - dayOfWeek * 24 * 60 * 60 * 1000);
      const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      return { gte: weekStart, lte: weekEnd };
    }
    case "this_month": {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { gte: monthStart, lte: monthEnd };
    }
    default:
      // custom: no date filter
      return { gte: new Date(0), lte: new Date() };
  }
}

function timeAgo(date: Date): string {
  const now = new Date();
  const secondsAgo = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (secondsAgo < 60) return "just now";
  if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
  if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)}h ago`;
  if (secondsAgo < 604800) return `${Math.floor(secondsAgo / 86400)}d ago`;
  
  return date.toLocaleDateString();
}

function escapeCsv(value: unknown): string {
  const stringValue = value == null ? "" : String(value);
  if (stringValue.includes(",") || stringValue.includes("\"") || stringValue.includes("\n")) {
    return `"${stringValue.replace(/\"/g, '""')}"`;
  }
  return stringValue;
}

function formatClientName(user: {
  first_name: string | null;
  last_name: string | null;
  email: string;
}): string {
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return full || user.email;
}

function formatItemTypeLabel(itemType: string): string {
  return itemType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTransaction(
  items: Array<{ item_type: string; item_name: string; quantity: number }>,
): string {
  if (items.length === 0) return "Order";
  const primary = items[0];
  const label = `${formatItemTypeLabel(primary.item_type)} | ${primary.item_name}`;
  if (items.length === 1) return label;
  return `${label} +${items.length - 1}`;
}

async function getAssignedClientIds(staffId: bigint): Promise<bigint[]> {
  const assignedClients = await prisma.staffClientAssignment.findMany({
    where: {
      staff_id: staffId,
      is_active: true,
    },
    select: { client_user_id: true },
  });
  return assignedClients.map((assignment) => assignment.client_user_id);
}

/**
 * Staff inquiry isolation: assigned to this staff AND tied to an actively
 * assigned client (portfolio owner or sender). Nested under AND so callers
 * can still set a top-level search OR without overwriting client scope.
 */
function buildStaffScopedInquiryWhere(
  staffId: bigint,
  clientIds: bigint[],
): Prisma.InquiryWhereInput {
  return {
    assigned_to_staff_id: staffId,
    AND: [
      {
        OR: [
          { user_id: { in: clientIds } },
          { sender_user_id: { in: clientIds } },
        ],
      },
    ],
  };
}

// ──────────────────────────────────────────────────────────────
// Staff Marketing Service Class
// ──────────────────────────────────────────────────────────────

export class StaffMarketingService {
  constructor(
    private staffId: bigint,
    private requestId: string
  ) {}

  private async resolveAssignedOrderIdentifier(orderIdOrNumber: string): Promise<string> {
    const normalized = orderIdOrNumber.trim();
    if (!normalized) {
      throw createStaffMarketingError(
        StaffMarketingErrorCode.INVALID_FILTER_TYPE,
        "Invalid order id",
        400,
        this.requestId,
        { orderId: orderIdOrNumber },
      );
    }

    const clientIds = await getAssignedClientIds(this.staffId);
    if (clientIds.length === 0) {
      throw createStaffMarketingError(
        StaffMarketingErrorCode.CLIENT_NOT_ASSIGNED,
        "No assigned clients found",
        404,
        this.requestId,
      );
    }

    const order = await prisma.shopOrder.findFirst({
      where: /^\d+$/.test(normalized)
        ? {
            user_id: { in: clientIds },
            OR: [{ id: BigInt(normalized) }, { order_number: normalized }],
          }
        : {
            order_number: normalized,
            user_id: { in: clientIds },
          },
      select: { id: true },
    });

    if (!order) {
      throw createStaffMarketingError(
        StaffMarketingErrorCode.CLIENT_NOT_ASSIGNED,
        "Order not found or not assigned to this staff member",
        404,
        this.requestId,
        { orderId: normalized },
      );
    }

    return order.id.toString();
  }

  /**
   * Get dashboard summary for staff member
   */
  async getDashboardSummary(): Promise<DashboardSummary> {
    try {
      // Get total and active assigned clients
      const assignmentStats = await prisma.staffClientAssignment.groupBy({
        by: ["is_active"],
        where: { staff_id: this.staffId },
        _count: true,
      });

      const totalClients = assignmentStats.reduce((acc, row) => acc + row._count, 0);
      const activeClients = assignmentStats.find((row) => row.is_active)?._count ?? 0;

      const clientIds = await getAssignedClientIds(this.staffId);
      const inquiryScope =
        clientIds.length > 0
          ? buildStaffScopedInquiryWhere(this.staffId, clientIds)
          : null;

      // Get unread inquiries count (staff-assigned AND tied to assigned clients)
      const [unreadInquiries, newInquiriesResult, totalOrders, ordersResult] = await Promise.all([
        inquiryScope
          ? prisma.inquiry.count({
              where: {
                ...inquiryScope,
                status: { in: ["new", "unread"] },
              },
            })
          : Promise.resolve(0),
        inquiryScope
          ? prisma.inquiry.count({
              where: {
                ...inquiryScope,
                status: { in: ["new", "unread"] },
                created_at: {
                  gte: new Date(new Date().setHours(0, 0, 0, 0)),
                },
              },
            })
          : Promise.resolve(0),
        prisma.shopOrder.count({
          where: {
              user: {
                staffClientAssignmentsClient: {
                  some: {
                    staff_id: this.staffId,
                    is_active: true,
                  },
                },
              },
          },
        }),
        prisma.shopOrder.groupBy({
          by: ["status"],
          where: {
            user: {
                  staffClientAssignmentsClient: {
                    some: {
                      staff_id: this.staffId,
                      is_active: true,
                    },
                  },
                },
          },
          _count: true,
        }),
      ]);

      const pendingOrders = ordersResult.find((row) => row.status === "pending")?._count ?? 0;

      return {
        total_assigned_clients: totalClients,
        active_clients: activeClients,
        unread_inquiries: unreadInquiries,
        new_inquiries_today: newInquiriesResult,
        total_orders: totalOrders,
        orders_pending: pendingOrders,
        total_messages: 0, // Placeholder for messaging system
        unread_messages: 0, // Placeholder for messaging system
      };
    } catch (error) {
      throw createStaffMarketingError(
        StaffMarketingErrorCode.INTERNAL_ERROR,
        "Failed to fetch dashboard summary",
        500,
        this.requestId,
        { error: String(error) }
      );
    }
  }

  /**
   * Get list of clients assigned to this staff member
   */
  async getAssignedClients(filters: StaffMarketingListFilters = {}): Promise<{
    clients: StaffMarketingClient[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = parsePage(filters.page, this.requestId);
    const limit = parseLimit(filters.limit, this.requestId);
    const skip = (page - 1) * limit;
    const search = normalizeText(filters.search);
    const statusFilter = filters.status ?? "all";
    const dateFilter = filters.date_filter ?? "custom";

    try {
      const whereClause: Prisma.StaffClientAssignmentWhereInput = {
        staff_id: this.staffId,
      };

      // Status filter
      if (statusFilter === "active") {
        whereClause.is_active = true;
      } else if (statusFilter === "inactive") {
        whereClause.is_active = false;
      }

      // Search in client email, name, role, or company name
      if (search) {
        whereClause.client = {
          OR: [
            { email: { contains: search } },
            { first_name: { contains: search } },
            { last_name: { contains: search } },
            { role: { contains: search } },
            { company: { name: { contains: search } } },
          ],
        };
      }

      // Date filter
      if (dateFilter !== "custom") {
        const dateRange = getDateRangeFromFilter(dateFilter);
        whereClause.assigned_at = {
          gte: dateRange.gte,
          lte: dateRange.lte,
        };
      }

      const [total, assignments] = await Promise.all([
        prisma.staffClientAssignment.count({ where: whereClause }),
        prisma.staffClientAssignment.findMany({
          where: whereClause,
          select: {
            client_user_id: true,
            assigned_at: true,
            is_primary: true,
            is_active: true,
            client: {
              select: {
                user_id: true,
                email: true,
                first_name: true,
                last_name: true,
                role: true,
                company_id: true,
                company: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: { assigned_at: "desc" },
          take: limit,
          skip,
        }),
      ]);

      // Get unread inquiry counts for each client
      const clientIds = assignments.map((a) => a.client_user_id);
      const inquiryCounts = await prisma.inquiry.groupBy({
        by: ["user_id"],
        where: {
          user_id: { in: clientIds },
          status: { in: ["new", "unread"] },
        },
        _count: true,
      });

      // Get recent order counts for each client
      const orderCounts = await prisma.shopOrder.groupBy({
        by: ["user_id"],
        where: {
          user_id: { in: clientIds },
          placed_at: {
            gte: new Date(new Date().setDate(new Date().getDate() - 30)), // Last 30 days
          },
        },
        _count: true,
      });

      const inquiryMap = new Map(inquiryCounts.map((row) => [row.user_id.toString(), row._count]));
      const orderMap = new Map(orderCounts.map((row) => [row.user_id.toString(), row._count]));
      const cardCounts = await prisma.bizcard.groupBy({
        by: ["user_id"],
        where: { user_id: { in: clientIds } },
        _count: true,
      });
      const cardCountMap = new Map(cardCounts.map((row) => [row.user_id?.toString(), row._count]));

      const clients: StaffMarketingClient[] = assignments.map((assignment) => ({
        user_id: assignment.client.user_id.toString(),
        email: assignment.client.email,
        first_name: assignment.client.first_name,
        last_name: assignment.client.last_name,
        role: assignment.client.role,
        company_id: assignment.client.company_id?.toString() ?? null,
        company_name: assignment.client.company?.name ?? null,
        assigned_at: assignment.assigned_at.toISOString(),
        is_primary: assignment.is_primary,
        is_active: assignment.is_active,
        unread_inquiries: inquiryMap.get(assignment.client.user_id.toString()) ?? 0,
        recent_order_count: orderMap.get(assignment.client.user_id.toString()) ?? 0,
        card_count: cardCountMap.get(assignment.client.user_id.toString()) ?? 0,
      }));

      return {
        clients,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("INVALID_FILTER_TYPE")) {
        throw error;
      }
      throw createStaffMarketingError(
        StaffMarketingErrorCode.INTERNAL_ERROR,
        "Failed to fetch assigned clients",
        500,
        this.requestId,
        { error: String(error) }
      );
    }
  }

  async updateAssignedClient(
    clientUserId: bigint,
    updates: {
      first_name?: string | null;
      last_name?: string | null;
      company_id?: bigint | null;
      is_active?: boolean;
    },
  ): Promise<StaffMarketingClient> {
    try {
      const assignment = await prisma.staffClientAssignment.findUnique({
        where: {
          staff_id_client_user_id: {
            staff_id: this.staffId,
            client_user_id: clientUserId,
          },
        },
        include: {
          client: {
            include: {
              company: {
                select: { name: true },
              },
            },
          },
        },
      });

      if (!assignment) {
        throw createStaffMarketingError(
          StaffMarketingErrorCode.CLIENT_NOT_ASSIGNED,
          "Client is not assigned to this staff member.",
          404,
          this.requestId,
        );
      }

      const normalizedUpdates: Record<string, unknown> = {};
      if (updates.first_name !== undefined) normalizedUpdates.first_name = updates.first_name;
      if (updates.last_name !== undefined) normalizedUpdates.last_name = updates.last_name;
      if (updates.is_active !== undefined) normalizedUpdates.is_active = updates.is_active;
      if (updates.company_id !== undefined) normalizedUpdates.company_id = updates.company_id;

      if (updates.company_id !== undefined && updates.company_id !== null) {
        const companyExists = await prisma.company.findUnique({
          where: { company_id: updates.company_id },
          select: { company_id: true },
        });
        if (!companyExists) {
          throw createStaffMarketingError(
            StaffMarketingErrorCode.INVALID_FILTER_TYPE,
            "Company not found.",
            404,
            this.requestId,
          );
        }
      }

      const updatedUser = await prisma.user.update({
        where: { user_id: clientUserId },
        data: normalizedUpdates,
        include: {
          company: {
            select: { name: true },
          },
        },
      });

      const cardCounts = await prisma.bizcard.groupBy({
        by: ["user_id"],
        where: { user_id: clientUserId },
        _count: true,
      });
      const cardCount = cardCounts[0]?._count ?? 0;

      const inquiryCount = await prisma.inquiry.count({
        where: {
          user_id: clientUserId,
          status: { in: ["new", "unread"] },
        },
      });

      const orderCount = await prisma.shopOrder.count({
        where: {
          user_id: clientUserId,
          placed_at: {
            gte: new Date(new Date().setDate(new Date().getDate() - 30)),
          },
        },
      });

      return {
        user_id: updatedUser.user_id.toString(),
        email: updatedUser.email,
        first_name: updatedUser.first_name,
        last_name: updatedUser.last_name,
        role: updatedUser.role,
        company_id: updatedUser.company_id?.toString() ?? null,
        company_name: updatedUser.company?.name ?? null,
        assigned_at: assignment.assigned_at.toISOString(),
        is_primary: assignment.is_primary,
        is_active: updatedUser.is_active,
        unread_inquiries: inquiryCount,
        recent_order_count: orderCount,
        card_count: cardCount,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("INVALID_FILTER_TYPE")) {
        throw error;
      }
      throw createStaffMarketingError(
        StaffMarketingErrorCode.INTERNAL_ERROR,
        "Failed to update assigned client",
        500,
        this.requestId,
        { error: String(error) },
      );
    }
  }

  async unassignClient(clientUserId: bigint): Promise<void> {
    try {
      const assignment = await prisma.staffClientAssignment.findUnique({
        where: {
          staff_id_client_user_id: {
            staff_id: this.staffId,
            client_user_id: clientUserId,
          },
        },
      });

      if (!assignment) {
        throw createStaffMarketingError(
          StaffMarketingErrorCode.CLIENT_NOT_ASSIGNED,
          "Client is not assigned to this staff member.",
          404,
          this.requestId,
        );
      }

      await prisma.staffClientAssignment.update({
        where: {
          staff_id_client_user_id: {
            staff_id: this.staffId,
            client_user_id: clientUserId,
          },
        },
        data: {
          is_active: false,
        },
      });
      await new SupportMessagingService().synchronizeClientAssignment(
        clientUserId,
        null,
        this.staffId,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("INVALID_FILTER_TYPE")) {
        throw error;
      }
      throw createStaffMarketingError(
        StaffMarketingErrorCode.INTERNAL_ERROR,
        "Failed to unassign client",
        500,
        this.requestId,
        { error: String(error) },
      );
    }
  }

  /**
   * Get inquiries for clients assigned to this staff member.
   * Isolation: assigned_to_staff_id must match this staff AND the inquiry
   * must involve an actively assigned client (portfolio owner or sender).
   */
  async getClientInquiries(filters: ClientInquiryFilters = {}): Promise<{
    inquiries: ClientInquiry[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = parsePage(filters.page, this.requestId);
    const limit = parseLimit(filters.limit, this.requestId);
    const skip = (page - 1) * limit;
    const search = normalizeText(filters.search);
    const status = normalizeText(filters.status);
    const dateFilter = filters.date_filter ?? "custom";

    try {
      const clientIds = await getAssignedClientIds(this.staffId);

      if (clientIds.length === 0) {
        return {
          inquiries: [],
          total: 0,
          page,
          limit,
          totalPages: 0,
        };
      }

      const whereClause: Prisma.InquiryWhereInput = buildStaffScopedInquiryWhere(
        this.staffId,
        clientIds,
      );

      if (status) {
        whereClause.status = { equals: status };
      }

      if (search) {
        // Top-level OR is ANDed with assigned_to_staff_id and the client AND scope
        whereClause.OR = [
          { subject: { contains: search } },
          { visitor_name: { contains: search } },
          { visitor_email: { contains: search } },
        ];
      }

      if (dateFilter !== "custom") {
        const dateRange = getDateRangeFromFilter(dateFilter);
        whereClause.created_at = {
          gte: dateRange.gte,
          lte: dateRange.lte,
        };
      }

      const [total, inquiries] = await Promise.all([
        prisma.inquiry.count({ where: whereClause }),
        prisma.inquiry.findMany({
          where: whereClause,
          select: {
            inquiry_id: true,
            sender_user_id: true,
            visitor_name: true,
            visitor_email: true,
            subject: true,
            message: true,
            status: true,
            created_at: true,
            updated_at: true,
            assigned_to_staff_id: true,
          },
          orderBy: [{ created_at: "desc" }, { status: "desc" }],
          take: limit,
          skip,
        }),
      ]);

      const clientInquiries: ClientInquiry[] = inquiries.map((inq) => ({
        inquiry_id: inq.inquiry_id.toString(),
        sender_user_id: inq.sender_user_id?.toString() ?? null,
        visitor_name: inq.visitor_name,
        visitor_email: inq.visitor_email,
        subject: inq.subject,
        message: inq.message,
        status: inq.status,
        created_at: inq.created_at.toISOString(),
        updated_at: inq.updated_at?.toISOString() ?? null,
        assigned_to_staff_id: inq.assigned_to_staff_id?.toString() ?? null,
      }));

      return {
        inquiries: clientInquiries,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("INVALID_FILTER_TYPE")) {
        throw error;
      }
      throw createStaffMarketingError(
        StaffMarketingErrorCode.INTERNAL_ERROR,
        "Failed to fetch client inquiries",
        500,
        this.requestId,
        { error: String(error) }
      );
    }
  }

  /**
   * Get orders from clients assigned to this staff member
   */
  async getClientOrders(filters: StaffOrderListFilters = {}): Promise<{
    orders: ClientOrder[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    status_counts: Record<StaffOrderColumn, number>;
  }> {
    const page = parsePage(filters.page, this.requestId);
    const limit = parseLimit(filters.limit, this.requestId);
    const skip = (page - 1) * limit;
    const statusFilter = filters.status ?? "all";
    const search = normalizeText(filters.search);
    const dateFilter = filters.date_filter ?? "custom";

    try {
      const clientIds = await getAssignedClientIds(this.staffId);

      if (clientIds.length === 0) {
        return {
          orders: [],
          total: 0,
          page,
          limit,
          totalPages: 0,
          status_counts: {
            pending: 0,
            processed: 0,
            ready_for_pickup: 0,
            completed: 0,
            cancelled: 0,
          },
        };
      }

      const baseWhere: Prisma.ShopOrderWhereInput = {
        user_id: { in: clientIds },
      };

      if (dateFilter !== "custom") {
        const dateRange = getDateRangeFromFilter(dateFilter);
        baseWhere.placed_at = {
          gte: dateRange.gte,
          lte: dateRange.lte,
        };
      }

      const statusCounts = await this.getOrderStatusCounts(baseWhere);

      let whereClause: Prisma.ShopOrderWhereInput = { ...baseWhere };

      if (statusFilter !== "all") {
        whereClause = {
          ...whereClause,
          status: { in: getStatusesForColumn(statusFilter) },
        };
      }

      if (search) {
        whereClause = {
          ...whereClause,
          OR: [
            { order_number: { contains: search } },
            {
              user: {
                OR: [
                  { first_name: { contains: search } },
                  { last_name: { contains: search } },
                  { email: { contains: search } },
                ],
              },
            },
            {
              items: {
                some: {
                  item_name: { contains: search },
                },
              },
            },
          ],
        };
      }

      const [total, orders] = await Promise.all([
        prisma.shopOrder.count({ where: whereClause }),
        prisma.shopOrder.findMany({
          where: whereClause,
          select: {
            id: true,
            order_number: true,
            user_id: true,
            total_amount: true,
            status: true,
            placed_at: true,
            status_changed_at: true,
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
              },
              orderBy: { id: "asc" },
            },
          },
          orderBy: { placed_at: "desc" },
          take: limit,
          skip,
        }),
      ]);

      const clientOrders: ClientOrder[] = orders.map((order) => ({
        shop_order_id: order.id.toString(),
        order_number: order.order_number,
        user_id: order.user_id.toString(),
        company_id: null,
        client_name: formatClientName(order.user),
        transaction: formatTransaction(order.items),
        quantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
        total_amount: order.total_amount.toString(),
        status: order.status,
        created_at: order.placed_at.toISOString(),
        updated_at: order.status_changed_at?.toISOString() ?? null,
      }));

      return {
        orders: clientOrders,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        status_counts: statusCounts,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("INVALID_FILTER_TYPE")) {
        throw error;
      }
      throw createStaffMarketingError(
        StaffMarketingErrorCode.INTERNAL_ERROR,
        "Failed to fetch client orders",
        500,
        this.requestId,
        { error: String(error) }
      );
    }
  }

  async getOrderStatusCounts(
    baseWhere: Prisma.ShopOrderWhereInput = {},
  ): Promise<Record<StaffOrderColumn, number>> {
    const clientIds = await getAssignedClientIds(this.staffId);
    if (clientIds.length === 0) {
      return {
        pending: 0,
        processed: 0,
        ready_for_pickup: 0,
        completed: 0,
        cancelled: 0,
      };
    }

    const whereClause: Prisma.ShopOrderWhereInput = {
      ...baseWhere,
      user_id: { in: clientIds },
    };

    const grouped = await prisma.shopOrder.groupBy({
      by: ["status"],
      where: whereClause,
      _count: true,
    });

    const counts: Record<StaffOrderColumn, number> = {
      pending: 0,
      processed: 0,
      ready_for_pickup: 0,
      completed: 0,
      cancelled: 0,
    };

    for (const row of grouped) {
      const column = normalizeOrderToColumn(row.status);
      counts[column] += row._count;
    }

    return counts;
  }

  async getClientOrderDetail(orderId: string): Promise<StaffClientOrderDetail> {
    const resolvedOrderId = await this.resolveAssignedOrderIdentifier(orderId);
    const service = new OrderManagementService(this.requestId);
    return service.getOrderDetail(resolvedOrderId) as Promise<StaffClientOrderDetail>;
  }

  async getClientOrderTimeline(orderId: string): Promise<StaffClientOrderTimeline> {
    const resolvedOrderId = await this.resolveAssignedOrderIdentifier(orderId);
    const service = new OrderManagementService(this.requestId);
    return service.getOrderTimeline(resolvedOrderId) as Promise<StaffClientOrderTimeline>;
  }

  async updateClientOrderStatus(
    orderId: string,
    targetColumn: StaffOrderColumn,
    reason?: string,
  ): Promise<ClientOrder> {
    const normalizedOrderId = orderId.trim();
    if (!/^\d+$/.test(normalizedOrderId)) {
      throw createStaffMarketingError(
        StaffMarketingErrorCode.INVALID_FILTER_TYPE,
        "Invalid order id",
        400,
        this.requestId,
        { orderId },
      );
    }

    const clientIds = await getAssignedClientIds(this.staffId);
    if (clientIds.length === 0) {
      throw createStaffMarketingError(
        StaffMarketingErrorCode.INTERNAL_ERROR,
        "No assigned clients found",
        404,
        this.requestId,
      );
    }

    const existing = await prisma.shopOrder.findFirst({
      where: {
        id: BigInt(normalizedOrderId),
        user_id: { in: clientIds },
      },
      select: {
        id: true,
        order_number: true,
        user_id: true,
        total_amount: true,
        status: true,
        placed_at: true,
        status_changed_at: true,
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
          },
          orderBy: { id: "asc" },
        },
      },
    });

    if (!existing) {
      throw createStaffMarketingError(
        StaffMarketingErrorCode.INTERNAL_ERROR,
        "Order not found or not assigned to this staff member",
        404,
        this.requestId,
        { orderId: normalizedOrderId },
      );
    }

    if (!canStaffColumnTransition(existing.status, targetColumn)) {
      throw createStaffMarketingError(
        StaffMarketingErrorCode.INVALID_FILTER_TYPE,
        `Cannot transition order from '${existing.status}' to '${targetColumn}'`,
        409,
        this.requestId,
        { from: existing.status, to: targetColumn },
      );
    }

    const nextStatus = COLUMN_CANONICAL_STATUS[targetColumn];
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.shopOrder.update({
        where: { id: existing.id },
        data: {
          status: nextStatus,
          status_changed_at: now,
          status_changed_by: this.staffId,
          status_change_note: normalizeText(reason) ?? null,
          completed_at: targetColumn === "completed" ? now : undefined,
          cancelled_at: targetColumn === "cancelled" ? now : undefined,
        },
        select: {
          id: true,
          order_number: true,
          user_id: true,
          total_amount: true,
          status: true,
          placed_at: true,
          status_changed_at: true,
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
            },
            orderBy: { id: "asc" },
          },
        },
      });

      await tx.orderStatusAuditLog.create({
        data: {
          order_id: existing.id,
          previous_status: existing.status,
          next_status: nextStatus,
          reason: normalizeText(reason) ?? null,
          changed_by: this.staffId,
          request_id: this.requestId,
        },
      });

      return order;
    });

    return {
      shop_order_id: updated.id.toString(),
      order_number: updated.order_number,
      user_id: updated.user_id.toString(),
      company_id: null,
      client_name: formatClientName(updated.user),
      transaction: formatTransaction(updated.items),
      quantity: updated.items.reduce((sum, item) => sum + item.quantity, 0),
      total_amount: updated.total_amount.toString(),
      status: updated.status,
      created_at: updated.placed_at.toISOString(),
      updated_at: updated.status_changed_at?.toISOString() ?? null,
    };
  }

  /**
   * Get clients who have messaged this staff member, with unread counts
   */
  async getMessagingClients(filters: StaffMarketingListFilters = {}): Promise<{
    clients: MessagingClient[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = parsePage(filters.page, this.requestId);
    const limit = parseLimit(filters.limit, this.requestId);
    const skip = (page - 1) * limit;
    const search = normalizeText(filters.search);

    try {
      // For now, return clients with unread inquiries as messaging clients
      const whereClause: Prisma.UserWhereInput = {
        staffClientAssignmentsClient: {
          some: {
            staff_id: this.staffId,
            is_active: true,
          },
        },
        inquiries: {
          some: {
            assigned_to_staff_id: this.staffId,
            status: { in: ["new", "unread"] },
          },
        },
      };

      if (search) {
        whereClause.OR = [{ email: { contains: search } }, { first_name: { contains: search } }];
      }

      const [total, users] = await Promise.all([
        prisma.user.count({ where: whereClause }),
        prisma.user.findMany({
          where: whereClause,
          select: {
            user_id: true,
            email: true,
            first_name: true,
            last_name: true,
            inquiries: {
              where: {
                assigned_to_staff_id: this.staffId,
                status: { in: ["new", "unread"] },
              },
              select: { created_at: true },
              orderBy: { created_at: "desc" },
              take: 1,
            },
          },
          orderBy: { user_id: "asc" },
          take: limit,
          skip,
        }),
      ]);

      const clients: MessagingClient[] = users.map((user) => {
        const unreadInquiries = user.inquiries.filter((inq) => true).length;
        const lastMessageAt = user.inquiries[0]?.created_at;

        return {
          user_id: user.user_id.toString(),
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          unread_message_count: unreadInquiries,
          last_message_at: lastMessageAt?.toISOString() ?? null,
        };
      });

      return {
        clients,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("INVALID_FILTER_TYPE")) {
        throw error;
      }
      throw createStaffMarketingError(
        StaffMarketingErrorCode.INTERNAL_ERROR,
        "Failed to fetch messaging clients",
        500,
        this.requestId,
        { error: String(error) }
      );
    }
  }

  /**
   * Mark inquiry as read
   */
  async markInquiryAsRead(inquiryId: bigint): Promise<void> {
    try {
      const inquiry = await prisma.inquiry.findUnique({
        where: { inquiry_id: inquiryId },
        select: { assigned_to_staff_id: true, status: true },
      });

      if (!inquiry) {
        throw createStaffMarketingError(
          StaffMarketingErrorCode.INQUIRY_NOT_FOUND,
          "Inquiry not found",
          404,
          this.requestId,
          { inquiryId: inquiryId.toString() }
        );
      }

      if (inquiry.assigned_to_staff_id !== this.staffId) {
        throw createStaffMarketingError(
          StaffMarketingErrorCode.INQUIRY_NOT_ASSIGNED_TO_STAFF,
          "You cannot update this inquiry",
          403,
          this.requestId,
          { inquiryId: inquiryId.toString() }
        );
      }

      await prisma.inquiry.update({
        where: { inquiry_id: inquiryId },
        data: { status: "read", updated_at: new Date() },
      });
    } catch (error) {
      if (error instanceof Error && (error.message.includes("NOT_FOUND") || error.message.includes("INSUFFICIENT"))) {
        throw error;
      }
      throw createStaffMarketingError(
        StaffMarketingErrorCode.INTERNAL_ERROR,
        "Failed to mark inquiry as read",
        500,
        this.requestId,
        { error: String(error) }
      );
    }
  }

  async markInquiryRead(inquiryId: bigint): Promise<void> {
    return this.markInquiryAsRead(inquiryId);
  }

  async replyToInquiry(inquiryId: bigint, message: string): Promise<void> {
    try {
      const inquiry = await prisma.inquiry.findUnique({
        where: { inquiry_id: inquiryId },
        select: { assigned_to_staff_id: true },
      });

      if (!inquiry) {
        throw createStaffMarketingError(
          StaffMarketingErrorCode.INQUIRY_NOT_FOUND,
          "Inquiry not found",
          404,
          this.requestId,
          { inquiryId: inquiryId.toString() }
        );
      }

      if (inquiry.assigned_to_staff_id !== this.staffId) {
        throw createStaffMarketingError(
          StaffMarketingErrorCode.INQUIRY_NOT_ASSIGNED_TO_STAFF,
          "You cannot reply to this inquiry",
          403,
          this.requestId,
          { inquiryId: inquiryId.toString() }
        );
      }

      await prisma.inquiry.update({
        where: { inquiry_id: inquiryId },
        data: {
          status: "replied",
          updated_at: new Date(),
          message: message,
        },
      });
    } catch (error) {
      if (error instanceof Error && (error.message.includes("NOT_FOUND") || error.message.includes("INSUFFICIENT"))) {
        throw error;
      }
      throw createStaffMarketingError(
        StaffMarketingErrorCode.INTERNAL_ERROR,
        "Failed to reply to inquiry",
        500,
        this.requestId,
        { error: String(error) }
      );
    }
  }

  /**
   * Export clients report as structured data for CSV/JSON
   */
  async exportClientsReport(options?: {
    dateFilter?: string | undefined;
    customStartDate?: string | undefined;
    customEndDate?: string | undefined;
  }): Promise<{ headers: string[]; rows: Array<Record<string, any>> }> {
    try {
      const assignments = await prisma.staffClientAssignment.findMany({
        where: { staff_id: this.staffId },
        select: {
          client_user_id: true,
          assigned_at: true,
          is_primary: true,
          is_active: true,
          client: {
            select: {
              email: true,
              first_name: true,
              last_name: true,
              company_id: true,
            },
          },
          company: {
            select: {
              name: true,
            },
          },
        },
        orderBy: { assigned_at: "desc" },
        take: MAX_EXPORT_ROWS,
      });

      if (assignments.length === 0) {
        throw createStaffMarketingError(
          StaffMarketingErrorCode.CLIENT_NOT_ASSIGNED,
          "No clients assigned to export",
          400,
          this.requestId
        );
      }

      // Build structured headers and rows
      const headers = [
        "Client Email",
        "First Name",
        "Last Name",
        "Company",
        "Assigned Date",
        "Primary Assignment",
        "Active",
      ];
      const rows: Array<Record<string, any>> = [];

      // Get unread inquiry and order counts
      const clientIds = assignments.map((a) => a.client_user_id);
      const inquiryCounts = await prisma.inquiry.groupBy({
        by: ["user_id"],
        where: { user_id: { in: clientIds } },
        _count: true,
      });

      const orderCounts = await prisma.shopOrder.groupBy({
        by: ["user_id"],
        where: { user_id: { in: clientIds } },
        _count: true,
      });

      const inquiryMap = new Map(inquiryCounts.map((row) => [row.user_id.toString(), row._count]));
      const orderMap = new Map(orderCounts.map((row) => [row.user_id.toString(), row._count]));

      // Build structured rows
      for (const assignment of assignments) {
        rows.push({
          "Client Email": assignment.client.email,
          "First Name": assignment.client.first_name,
          "Last Name": assignment.client.last_name,
          Company: assignment.company?.name ?? null,
          "Assigned Date": assignment.assigned_at.toLocaleDateString(),
          "Primary Assignment": assignment.is_primary ? "Yes" : "No",
          Active: assignment.is_active ? "Active" : "Inactive",
        });
      }

      return { headers, rows };
    } catch (error) {
      if (error instanceof Error && (error.message.includes("CLIENT_NOT_ASSIGNED"))) {
        throw error;
      }
      throw createStaffMarketingError(
        StaffMarketingErrorCode.EXPORT_GENERATION_FAILED,
        "Failed to generate clients report",
        500,
        this.requestId,
        { error: String(error) }
      );
    }
  }
}
