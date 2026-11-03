"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { showToast } from "@/app/components/Toast";
import {
  CheckCircle2,
  ChevronDown,
  Clock3,
  CreditCard,
  Download,
  FileSpreadsheet,
  Filter,
  LayoutGrid,
  List,
  PackageCheck,
  Printer,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  PortalModal,
  PortalPageHeader,
  PortalStatCard,
  PORTAL_ACCENTS,
} from "./ui";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import OrdersBoard from "./orders/OrdersBoard";
import OrdersList from "./orders/OrdersList";
import OrderDetailDrawer from "./orders/OrderDetailDrawer";
import {
  formatDate,
  formatPeso,
  mapOrderRecord,
  summarizeStatusCount,
  toNumber,
  type CustomerType,
  type OrderRecord,
} from "./orders/orderMappers";
import {
  STATUS_SUMMARY_CARDS,
  apiStatusToLabel,
  canTransitionStatus,
  labelToApiStatus,
  normalizeOrderToColumn,
  type ManagedOrderApiStatus,
  type OrderStatusLabel,
  type SuperAdminOrderColumn,
} from "./orders/orderStatus";

function getOrdersApiBase(): string {
  return getFrontendApiBaseUrl();
}

type DateRangePreset = "all_time" | "today" | "yesterday" | "this_week" | "this_month" | "custom";
type ExportFormat = "csv" | "xlsx" | "pdf";
type ExportScope = "all_records" | "specific_records";
type ViewMode = "list" | "board";
type BulkAction =
  | ""
  | "bulk_delete"
  | "bulk_export"
  | "status_pending"
  | "status_paid"
  | "status_processing"
  | "status_completed"
  | "status_cancelled";
type PaginationToken = number | "ellipsis";

const LIST_PAGE_SIZE = 10;
const BOARD_PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 350;

const SUMMARY_ICONS = [Clock3, CreditCard, FileSpreadsheet, PackageCheck, XCircle] as const;

const SUMMARY_ACCENTS = [
  PORTAL_ACCENTS.warning,
  PORTAL_ACCENTS.revenue,
  PORTAL_ACCENTS.orders,
  PORTAL_ACCENTS.revenue,
  PORTAL_ACCENTS.danger,
] as const;

function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    searchParams.set(key, String(value));
  });
  return searchParams.toString();
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function resolveDateRange(
  preset: DateRangePreset,
  customStart: string,
  customEnd: string,
): { start: Date; end: Date } | null {
  const now = new Date();
  const today = startOfDay(now);

  if (preset === "all_time") return null;
  if (preset === "today") return { start: today, end: endOfDay(today) };
  if (preset === "yesterday") {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return { start: yesterday, end: endOfDay(yesterday) };
  }
  if (preset === "this_week") {
    const weekStart = new Date(today);
    const weekDay = weekStart.getDay();
    const offset = weekDay === 0 ? -6 : 1 - weekDay;
    weekStart.setDate(weekStart.getDate() + offset);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    return { start: startOfDay(weekStart), end: endOfDay(weekEnd) };
  }
  if (preset === "this_month") {
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { start: monthStart, end: endOfDay(monthEnd) };
  }
  if (preset === "custom") {
    if (!customStart || !customEnd) return null;
    const parsedStart = new Date(`${customStart}T00:00:00`);
    const parsedEnd = new Date(`${customEnd}T23:59:59`);
    if (Number.isNaN(parsedStart.getTime()) || Number.isNaN(parsedEnd.getTime())) return null;
    return { start: parsedStart, end: parsedEnd };
  }
  return null;
}

function buildPaginationTokens(currentPage: number, totalPages: number): PaginationToken[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  if (currentPage <= 3) return [1, 2, 3, "ellipsis", totalPages];
  if (currentPage >= totalPages - 2) {
    return [1, "ellipsis", totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages];
}

function ConfirmationModal({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  loading,
  open,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
  open: boolean;
}) {
  return (
    <PortalModal
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      size="sm"
      preventClose={loading}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-xl border border-gray-100 bg-white px-4 py-2 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-xl border border-[#b34848] bg-[#c65252] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#b34848] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Processing..." : confirmLabel}
          </button>
        </div>
      }
    >
      <p className="sr-only">{message}</p>
    </PortalModal>
  );
}

function exportOrdersToCsv(rows: OrderRecord[], fileName: string): void {
  const header = [
    "Order ID",
    "Date",
    "Customer Name",
    "Customer Email",
    "Customer Type",
    "Items",
    "Payment Method",
    "Amount",
    "Status",
    "Transaction ID",
    "Carrier",
    "Tracking Number",
  ];

  const body = rows.map((order) => [
    order.orderId,
    formatDate(order.dateIso),
    order.customerName,
    order.customerEmail,
    order.customerType,
    order.itemsSummary,
    order.paymentMethod,
    formatPeso(order.amount),
    order.status,
    order.transactionId,
    order.shippingCarrier,
    order.trackingNumber,
  ]);

  const csv = [header, ...body]
    .map((line) => line.map((value) => csvEscape(String(value))).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.URL.revokeObjectURL(url);
}

export default function OrdersManagementPanel() {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [ordersMeta, setOrdersMeta] = useState({ total: 0, totalPages: 1 });
  const [summaryCounts, setSummaryCounts] = useState<Record<ManagedOrderApiStatus, number>>({
    pending: 0,
    paid: 0,
    processed: 0,
    completed: 0,
    cancelled: 0,
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | OrderStatusLabel>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | CustomerType>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [viewMenuOpen, setViewMenuOpen] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = viewMode === "board" ? BOARD_PAGE_SIZE : LIST_PAGE_SIZE;

  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<BulkAction>("");

  const [deleteTarget, setDeleteTarget] = useState<OrderRecord | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedFallbackOrder, setSelectedFallbackOrder] = useState<OrderRecord | null>(null);
  const [drawerRefreshKey, setDrawerRefreshKey] = useState(0);

  const [editOrder, setEditOrder] = useState<OrderRecord | null>(null);
  const [editStatus, setEditStatus] = useState<OrderStatusLabel>("Pending");
  const [editNotes, setEditNotes] = useState("");
  const [editTrackingNumber, setEditTrackingNumber] = useState("");
  const [editTrackingCarrier, setEditTrackingCarrier] = useState("");
  const [editTrackingUrl, setEditTrackingUrl] = useState("");

  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<ExportScope>("all_records");
  const [exportDatePreset, setExportDatePreset] = useState<DateRangePreset>("this_month");
  const [exportCustomStartDate, setExportCustomStartDate] = useState("");
  const [exportCustomEndDate, setExportCustomEndDate] = useState("");
  const [exportStatusFilter, setExportStatusFilter] = useState<"all" | OrderStatusLabel>("all");
  const [exportTypeFilter, setExportTypeFilter] = useState<"all" | CustomerType>("all");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("csv");

  const [highlightedOrderIds, setHighlightedOrderIds] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);

  const highlightTimeoutRef = useRef<number | null>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const updatingOrderIdRef = useRef<string | null>(null);

  const totalPages = Math.max(1, ordersMeta.totalPages);
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const firstVisibleRow = ordersMeta.total === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
  const lastVisibleRow = Math.min(safeCurrentPage * pageSize, ordersMeta.total);
  const paginationTokens = useMemo(
    () => buildPaginationTokens(safeCurrentPage, totalPages),
    [safeCurrentPage, totalPages],
  );
  const currentPageOrderIds = orders.map((order) => order.id);
  const allVisibleSelected =
    currentPageOrderIds.length > 0 &&
    currentPageOrderIds.every((id) => selectedOrderIds.includes(id));

  useEffect(() => {
    draggingRef.current = dragging;
  }, [dragging]);

  useEffect(() => {
    updatingOrderIdRef.current = updatingOrderId;
  }, [updatingOrderId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setCurrentPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (viewMenuRef.current && !viewMenuRef.current.contains(event.target as Node)) {
        setViewMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      const response = await fetch(`${getOrdersApiBase()}/api/superadmin/orders/summary`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { data?: Record<string, unknown> };
      const data = (payload.data ?? {}) as Record<string, unknown>;
      const byStatus = (data.by_status ?? {}) as Record<string, unknown>;
      setSummaryCounts({
        pending: summarizeStatusCount(byStatus.pending),
        paid: summarizeStatusCount(byStatus.paid),
        processed: summarizeStatusCount(byStatus.processed ?? byStatus.processing),
        completed: summarizeStatusCount(byStatus.completed),
        cancelled: summarizeStatusCount(byStatus.cancelled ?? byStatus.canceled),
      });
    } catch {
      // Keep existing summary values on fetch failure.
    }
  }, []);

  const fetchOrders = useCallback(
    async (page: number, options?: { silent?: boolean }) => {
      if (draggingRef.current || updatingOrderIdRef.current) return;
      if (!options?.silent) setLoadingOrders(true);
      try {
        const apiStatus =
          statusFilter === "all" ? undefined : labelToApiStatus(statusFilter);
        const query = buildQuery({
          page,
          limit: pageSize,
          search: debouncedSearch || undefined,
          status: apiStatus,
        });
        const response = await fetch(`${getOrdersApiBase()}/api/superadmin/orders?${query}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) {
          showToast({ type: "error", message: "Failed to fetch orders from backend." });
          return;
        }
        const payload = (await response.json()) as { data?: Record<string, unknown> };
        const data = (payload.data ?? {}) as Record<string, unknown>;
        const rowsRaw = Array.isArray(data.orders)
          ? data.orders
          : Array.isArray(data.items)
            ? data.items
            : Array.isArray(data.records)
              ? data.records
              : [];

        let mapped = rowsRaw.map((row, index) =>
          mapOrderRecord((row ?? {}) as Record<string, unknown>, index),
        );
        if (typeFilter !== "all") {
          mapped = mapped.filter((item) => item.customerType === typeFilter);
        }
        setOrders(mapped);

        const pagination = (data.pagination ?? {}) as Record<string, unknown>;
        const total = toNumber(data.total ?? pagination.total ?? mapped.length, mapped.length);
        const totalPagesValue = toNumber(
          data.total_pages ??
            pagination.total_pages ??
            pagination.pages ??
            Math.max(1, Math.ceil(total / pageSize)),
          Math.max(1, Math.ceil(Math.max(total, 1) / pageSize)),
        );
        setOrdersMeta({
          total,
          totalPages: Math.max(1, totalPagesValue),
        });
      } catch {
        showToast({ type: "error", message: "Unable to connect to orders backend." });
      } finally {
        if (!options?.silent) setLoadingOrders(false);
      }
    },
    [debouncedSearch, pageSize, statusFilter, typeFilter],
  );

  useEffect(() => {
    void fetchOrders(currentPage);
    void fetchSummary();
  }, [currentPage, fetchOrders, fetchSummary, viewMode]);

  useEffect(() => {
    const streamUrl = `${getOrdersApiBase()}/api/superadmin/orders/stream`;
    let source: EventSource | null = null;
    let closed = false;

    try {
      source = new EventSource(streamUrl, { withCredentials: true });
      source.addEventListener("order-status", () => {
        if (closed) return;
        void fetchOrders(currentPage, { silent: true });
        void fetchSummary();
        setDrawerRefreshKey((value) => value + 1);
      });
      source.onerror = () => {
        // Browser will retry; avoid noisy toasts for transient disconnects.
      };
    } catch {
      // SSE unsupported or blocked — list still works via manual refresh.
    }

    return () => {
      closed = true;
      source?.close();
    };
  }, [currentPage, fetchOrders, fetchSummary]);

  const highlightRows = (ids: string[]) => {
    if (!ids.length) return;
    setHighlightedOrderIds(ids);
    if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedOrderIds([]);
      highlightTimeoutRef.current = null;
    }, 1200);
  };

  const handleToggleRowSelection = (id: string) => {
    setSelectedOrderIds((previous) =>
      previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id],
    );
  };

  const handleToggleSelectAllVisible = () => {
    setSelectedOrderIds((previous) => {
      if (allVisibleSelected) {
        return previous.filter((id) => !currentPageOrderIds.includes(id));
      }
      return [...new Set([...previous, ...currentPageOrderIds])];
    });
  };

  const openOrderDrawer = (order: OrderRecord) => {
    setSelectedOrderId(order.id);
    setSelectedFallbackOrder(order);
  };

  const openEditModal = (order: OrderRecord) => {
    setEditOrder(order);
    setEditStatus(order.status);
    setEditNotes(order.notes);
    setEditTrackingNumber(order.trackingNumber === "Pending" ? "" : order.trackingNumber);
    setEditTrackingCarrier(
      order.shippingCarrier === "To Be Assigned" ? "" : order.shippingCarrier,
    );
    setEditTrackingUrl(order.trackingUrl || "");
  };

  const updateSingleStatus = async (
    orderId: string,
    nextStatus: ManagedOrderApiStatus,
    options?: { reason?: string; tracking_number?: string; tracking_carrier?: string; tracking_url?: string },
  ) => {
    setUpdatingOrderId(orderId);
    try {
      const response = await fetch(
        `${getOrdersApiBase()}/api/superadmin/orders/${encodeURIComponent(orderId)}/status`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: nextStatus,
            reason: options?.reason,
            tracking_number: options?.tracking_number,
            tracking_carrier: options?.tracking_carrier,
            tracking_url: options?.tracking_url,
          }),
        },
      );
      if (!response.ok) throw new Error("status update failed");
      highlightRows([orderId]);
      await fetchOrders(currentPage, { silent: true });
      await fetchSummary();
      setDrawerRefreshKey((value) => value + 1);
      return true;
    } catch {
      showToast({ type: "error", message: "Failed to update order status." });
      return false;
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const handleBoardDrop = async (orderId: string, column: SuperAdminOrderColumn) => {
    const order = orders.find((item) => item.id === orderId);
    if (!order) return;
    const from = normalizeOrderToColumn(order.status);
    if (from === column) return;
    if (!canTransitionStatus(from, column)) {
      showToast({
        type: "error",
        message: `Cannot move from ${apiStatusToLabel(from)} to ${apiStatusToLabel(column)}.`,
      });
      return;
    }
    const ok = await updateSingleStatus(orderId, column, {
      reason: `Moved to ${apiStatusToLabel(column)} via board`,
    });
    if (ok) {
      showToast({
        type: "success",
        message: `Order ${order.orderId} moved to ${apiStatusToLabel(column)}.`,
      });
    }
  };

  const handleApplyBulkAction = async () => {
    if (!bulkAction) {
      showToast({ type: "error", message: "Select a bulk action first." });
      return;
    }
    if (selectedOrderIds.length === 0) {
      showToast({ type: "error", message: "Select at least one order for bulk actions." });
      return;
    }

    if (bulkAction === "bulk_delete") {
      try {
        const response = await fetch(`${getOrdersApiBase()}/api/superadmin/orders/bulk/status`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_ids: selectedOrderIds,
            status: "cancelled",
            reason: "Cancelled via bulk delete action",
          }),
        });
        if (!response.ok) throw new Error("bulk cancel failed");
        showToast({ type: "success", message: `${selectedOrderIds.length} order(s) cancelled.` });
        setSelectedOrderIds([]);
        setBulkAction("");
        await fetchOrders(currentPage);
        await fetchSummary();
      } catch {
        showToast({ type: "error", message: "Failed to process bulk delete action." });
      }
      return;
    }

    if (bulkAction === "bulk_export") {
      const rows = orders.filter((order) => selectedOrderIds.includes(order.id));
      exportOrdersToCsv(rows, "orders-bulk-export.csv");
      showToast({ type: "success", message: `${rows.length} selected order(s) exported.` });
      setBulkAction("");
      return;
    }

    const statusMap: Record<BulkAction, ManagedOrderApiStatus | null> = {
      "": null,
      bulk_delete: null,
      bulk_export: null,
      status_pending: "pending",
      status_paid: "paid",
      status_processing: "processed",
      status_completed: "completed",
      status_cancelled: "cancelled",
    };

    const nextStatus = statusMap[bulkAction];
    if (!nextStatus) return;

    try {
      const response = await fetch(`${getOrdersApiBase()}/api/superadmin/orders/bulk/status`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_ids: selectedOrderIds, status: nextStatus }),
      });
      if (!response.ok) throw new Error("bulk status update failed");
      highlightRows([...selectedOrderIds]);
      showToast({
        type: "success",
        message: `Updated ${selectedOrderIds.length} order(s) to ${apiStatusToLabel(nextStatus)}.`,
      });
      setBulkAction("");
      await fetchOrders(currentPage);
      await fetchSummary();
    } catch {
      showToast({ type: "error", message: "Bulk status update failed." });
    }
  };

  const handleSaveEditOrder = async () => {
    if (!editOrder) return;
    const ok = await updateSingleStatus(editOrder.id, labelToApiStatus(editStatus), {
      reason: editNotes.trim() || undefined,
      tracking_number: editTrackingNumber.trim() || undefined,
      tracking_carrier: editTrackingCarrier.trim() || undefined,
      tracking_url: editTrackingUrl.trim() || undefined,
    });
    if (ok) {
      showToast({ type: "success", message: `Order ${editOrder.orderId} updated successfully.` });
      setEditOrder(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const response = await fetch(
        `${getOrdersApiBase()}/api/superadmin/orders/${encodeURIComponent(deleteTarget.id)}/cancel`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "Cancelled by superadmin orders panel" }),
        },
      );
      if (!response.ok) throw new Error("cancel failed");
      setSelectedOrderIds((previous) => previous.filter((id) => id !== deleteTarget.id));
      showToast({ type: "success", message: `Order ${deleteTarget.orderId} cancelled.` });
      await fetchOrders(currentPage);
      await fetchSummary();
    } catch {
      showToast({ type: "error", message: "Failed to cancel order. Please try again." });
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleConfirmBulkDelete = async () => {
    if (selectedOrderIds.length < 2) {
      setBulkDeleteOpen(false);
      return;
    }
    setIsDeleting(true);
    try {
      const response = await fetch(`${getOrdersApiBase()}/api/superadmin/orders/bulk/delete`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_ids: selectedOrderIds }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error?.message ?? "bulk delete failed");
      }
      const deletedCount = Number(payload?.data?.deleted_count ?? selectedOrderIds.length);
      showToast({
        type: "success",
        message: `Permanently removed ${deletedCount} order record(s).`,
      });
      setSelectedOrderIds([]);
      setBulkAction("");
      setBulkDeleteOpen(false);
      await fetchOrders(currentPage);
      await fetchSummary();
    } catch {
      showToast({ type: "error", message: "Failed to permanently delete selected orders." });
    } finally {
      setIsDeleting(false);
    }
  };

  const resolveExportRows = (): OrderRecord[] => {
    if (exportScope === "all_records") return [...orders];
    let rows = [...orders];
    if (exportStatusFilter !== "all") {
      rows = rows.filter((order) => order.status === exportStatusFilter);
    }
    if (exportTypeFilter !== "all") {
      rows = rows.filter((order) => order.customerType === exportTypeFilter);
    }
    const range = resolveDateRange(exportDatePreset, exportCustomStartDate, exportCustomEndDate);
    if (range) {
      rows = rows.filter((order) => {
        const timestamp = new Date(`${order.dateIso}T00:00:00`);
        return timestamp >= range.start && timestamp <= range.end;
      });
    }
    return rows;
  };

  const handleConfirmExport = () => {
    const rows = resolveExportRows();
    if (rows.length === 0) {
      showToast({
        type: "error",
        message: "No records matched the selected export configuration.",
      });
      return;
    }

    const query = buildQuery({
      format: exportFormat === "pdf" ? undefined : exportFormat,
      search: exportScope === "all_records" ? debouncedSearch || undefined : undefined,
      status:
        exportScope === "all_records"
          ? statusFilter === "all"
            ? undefined
            : labelToApiStatus(statusFilter)
          : exportStatusFilter === "all"
            ? undefined
            : labelToApiStatus(exportStatusFilter),
      start_date: exportDatePreset === "custom" ? exportCustomStartDate || undefined : undefined,
      end_date: exportDatePreset === "custom" ? exportCustomEndDate || undefined : undefined,
    });
    const url =
      exportFormat === "pdf"
        ? `${getOrdersApiBase()}/api/superadmin/orders/report/pdf${query ? `?${query}` : ""}`
        : `${getOrdersApiBase()}/api/superadmin/orders/export${query ? `?${query}` : ""}`;

    fetch(url, { method: "GET", credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("export failed");
        const blob = await response.blob();
        const ext = exportFormat === "xlsx" ? "xlsx" : exportFormat === "pdf" ? "pdf" : "csv";
        const fileUrl = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = fileUrl;
        link.download = `orders-export.${ext}`;
        link.click();
        window.URL.revokeObjectURL(fileUrl);
        setIsExportOpen(false);
        showToast({
          type: "success",
          message: `Exported orders as ${exportFormat.toUpperCase()}.`,
        });
      })
      .catch(() => {
        if (exportFormat === "csv") {
          exportOrdersToCsv(rows, "orders-export.csv");
          setIsExportOpen(false);
          showToast({ type: "success", message: `Exported ${rows.length} order(s) as CSV.` });
          return;
        }
        showToast({ type: "error", message: "Export failed. Please try again." });
      });
  };

  return (
    <section className="space-y-6">
      <style jsx global>{`
        @media print {
          .orders-print-hide {
            display: none !important;
          }
          .orders-print-page {
            padding: 0 !important;
            margin: 0 !important;
          }
          .orders-print-surface {
            border: 1px solid #d1d9e6 !important;
            box-shadow: none !important;
          }
          .orders-print-table th,
          .orders-print-table td {
            color: #111827 !important;
            background: white !important;
            border-color: #e5e7eb !important;
            font-size: 12px !important;
          }
        }
      `}</style>

      <PortalPageHeader
        title="Orders Management"
        subtitle="Work orders like tasks — triage on the board, update in the drawer, track activity live."
        className="orders-print-hide"
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5 orders-print-hide sm:gap-5">
        {STATUS_SUMMARY_CARDS.map((card, index) => {
          const Icon = SUMMARY_ICONS[index] ?? CheckCircle2;
          const cardValue = summaryCounts[card.key] ?? 0;
          const active = statusFilter === card.uiStatus;
          const accent = SUMMARY_ACCENTS[index] ?? PORTAL_ACCENTS.orders;

          return (
            <button
              key={card.key}
              type="button"
              onClick={() => {
                setStatusFilter(active ? "all" : card.uiStatus);
                setCurrentPage(1);
              }}
              className={`text-left transition-transform active:scale-[0.99] ${active ? "rounded-3xl ring-2 ring-primary/30" : ""}`}
            >
              <PortalStatCard
                label={card.label}
                value={String(cardValue)}
                icon={Icon}
                accent={accent}
              />
            </button>
          );
        })}
      </section>

      <section className="space-y-4 orders-print-page">
        <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm orders-print-surface">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div className="relative w-full sm:w-96">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8ca0c2]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search by order ID, customer name, or email"
                  className="h-11 w-full rounded-xl border border-gray-100 bg-[#fbfdff] pl-10 pr-3 text-sm text-[#304a76] outline-none transition-colors focus:border-[#87acdd]"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value as "all" | OrderStatusLabel);
                  setCurrentPage(1);
                }}
                className="h-11 w-full rounded-xl border border-gray-100 bg-[#fbfdff] px-3 text-sm font-semibold text-[#2b467c] outline-none transition-colors focus:border-[#89addd] sm:w-auto"
              >
                <option value="all">All Status</option>
                <option value="Pending">Pending</option>
                <option value="Payment Completed">Payment Completed</option>
                <option value="Processing">Processing</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>

              <select
                value={typeFilter}
                onChange={(event) => {
                  setTypeFilter(event.target.value as "all" | CustomerType);
                  setCurrentPage(1);
                }}
                className="h-11 w-full rounded-xl border border-gray-100 bg-[#fbfdff] px-3 text-sm font-semibold text-[#2b467c] outline-none transition-colors focus:border-[#89addd] sm:w-auto"
              >
                <option value="all">All Types</option>
                <option value="User">User</option>
                <option value="Company">Company</option>
                <option value="Admin">Admin</option>
              </select>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center orders-print-hide">
              <div className="relative min-w-0" ref={viewMenuRef}>
                <button
                  type="button"
                  onClick={() => setViewMenuOpen((open) => !open)}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-gray-100 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-50 sm:h-auto sm:w-auto sm:px-4"
                >
                  {viewMode === "board" ? (
                    <LayoutGrid className="h-4 w-4" />
                  ) : (
                    <List className="h-4 w-4" />
                  )}
                  {viewMode === "board" ? "Board" : "List"}
                  <ChevronDown className="h-4 w-4" />
                </button>
                {viewMenuOpen ? (
                  <div className="absolute right-0 z-20 mt-2 w-40 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-lg">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-gray-700 hover:bg-[#f4f8ff]"
                      onClick={() => {
                        setViewMode("list");
                        setViewMenuOpen(false);
                        setCurrentPage(1);
                      }}
                    >
                      <List className="h-4 w-4" /> List
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-gray-700 hover:bg-[#f4f8ff]"
                      onClick={() => {
                        setViewMode("board");
                        setViewMenuOpen(false);
                        setCurrentPage(1);
                      }}
                    >
                      <LayoutGrid className="h-4 w-4" /> Board
                    </button>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => setIsExportOpen(true)}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#3f86d4] bg-[#4798ee] px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#3f88d5] sm:h-auto sm:w-auto sm:px-4"
              >
                <Download className="h-4 w-4" />
                Export
              </button>

              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-gray-100 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-50 sm:h-auto sm:w-auto sm:px-4"
              >
                <Printer className="h-4 w-4" />
                Print
              </button>
            </div>
          </div>

          {viewMode === "list" ? (
            <div className="flex flex-col gap-3 border-t border-[#edf2fb] pt-3 sm:flex-row sm:items-center sm:justify-between orders-print-hide">
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <span className="inline-flex w-fit items-center gap-2 rounded-lg border border-gray-100 bg-[#fbfdff] px-3 py-2 text-xs font-semibold text-[#5f7295]">
                  <Filter className="h-3.5 w-3.5" />
                  Bulk Actions
                </span>
                <select
                  value={bulkAction}
                  onChange={(event) => setBulkAction(event.target.value as BulkAction)}
                  className="h-10 w-full rounded-lg border border-gray-100 bg-white px-3 text-sm font-semibold text-[#2b467c] outline-none transition-colors focus:border-[#89addd] sm:min-w-[200px] sm:flex-1 sm:w-auto"
                >
                  <option value="">Choose action</option>
                  <option value="bulk_delete">Bulk Cancel</option>
                  <option value="bulk_export">Bulk Export</option>
                  <option value="status_pending">Bulk Status: Pending</option>
                  <option value="status_paid">Bulk Status: Payment Completed</option>
                  <option value="status_processing">Bulk Status: Processing</option>
                  <option value="status_completed">Bulk Status: Completed</option>
                  <option value="status_cancelled">Bulk Status: Cancelled</option>
                </select>
                <div className="grid grid-cols-[1fr_auto] gap-2 sm:flex sm:items-center">
                  <button
                    type="button"
                    onClick={() => void handleApplyBulkAction()}
                    className="h-10 w-full rounded-lg border border-primary bg-primary px-3 text-sm font-semibold text-white transition-colors hover:bg-[#233f7d] sm:w-auto"
                  >
                    Apply
                  </button>
                  {selectedOrderIds.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setBulkDeleteOpen(true)}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-600 transition-colors hover:bg-rose-100"
                      title={`Permanently delete ${selectedOrderIds.length} selected orders`}
                      aria-label={`Permanently delete ${selectedOrderIds.length} selected orders`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>
              <p className="text-sm font-semibold text-[#5f7295]">
                Showing {firstVisibleRow}-{lastVisibleRow} of {ordersMeta.total} entries
              </p>
            </div>
          ) : (
            <p className="border-t border-[#edf2fb] pt-3 text-sm font-semibold text-[#5f7295] orders-print-hide">
              Drag cards between columns to update status. Terminal columns (Completed / Cancelled) do not allow outbound moves.
            </p>
          )}
        </div>

        {viewMode === "list" ? (
          <OrdersList
            loading={loadingOrders}
            orders={orders}
            selectedOrderIds={selectedOrderIds}
            highlightedOrderIds={highlightedOrderIds}
            allVisibleSelected={allVisibleSelected}
            onToggleSelectAll={handleToggleSelectAllVisible}
            onToggleRow={handleToggleRowSelection}
            onOpenDetails={openOrderDrawer}
            onEdit={openEditModal}
            onDelete={setDeleteTarget}
          />
        ) : (
          <OrdersBoard
            loading={loadingOrders}
            orders={orders}
            dragging={dragging || Boolean(updatingOrderId)}
            highlightedOrderIds={highlightedOrderIds}
            onDragStart={() => setDragging(true)}
            onDragEnd={() => setDragging(false)}
            onDrop={(orderId, column) => {
              void handleBoardDrop(orderId, column);
            }}
            onOpenOrder={openOrderDrawer}
          />
        )}

        {viewMode === "list" ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between orders-print-hide">
            <p className="text-sm font-semibold text-[#5f7295]">
              Page {safeCurrentPage} of {totalPages}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage(Math.max(1, safeCurrentPage - 1))}
                disabled={safeCurrentPage === 1}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-gray-100 px-3 text-sm font-semibold text-[#5f7295] transition-colors hover:bg-[#f4f8ff] disabled:cursor-not-allowed disabled:opacity-45"
              >
                Prev
              </button>
              {paginationTokens.map((token, index) => {
                if (token === "ellipsis") {
                  return (
                    <span
                      key={`ellipsis-${index}`}
                      className="px-1 text-sm font-semibold text-[#7b8cab]"
                    >
                      ...
                    </span>
                  );
                }
                const active = token === safeCurrentPage;
                return (
                  <button
                    key={token}
                    type="button"
                    onClick={() => setCurrentPage(token)}
                    className={`inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-2 text-sm font-semibold transition-colors ${
                      active
                        ? "border-[#3f8fe6] bg-[#3f8fe6] text-white"
                        : "border-gray-100 text-[#5f7295] hover:bg-[#f4f8ff]"
                    }`}
                  >
                    {token}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setCurrentPage(Math.min(totalPages, safeCurrentPage + 1))}
                disabled={safeCurrentPage === totalPages}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-gray-100 px-3 text-sm font-semibold text-[#5f7295] transition-colors hover:bg-[#f4f8ff] disabled:cursor-not-allowed disabled:opacity-45"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <OrderDetailDrawer
        open={Boolean(selectedOrderId)}
        orderId={selectedOrderId}
        fallbackOrder={selectedFallbackOrder}
        refreshKey={drawerRefreshKey}
        onClose={() => {
          setSelectedOrderId(null);
          setSelectedFallbackOrder(null);
        }}
        onStatusUpdated={() => {
          showToast({ type: "success", message: "Order updated." });
          void fetchOrders(currentPage, { silent: true });
          void fetchSummary();
          setDrawerRefreshKey((value) => value + 1);
        }}
      />

      <ConfirmationModal
        open={Boolean(deleteTarget)}
        title="Cancel Order"
        message={`Are you sure you want to cancel order ${deleteTarget?.orderId ?? ""}?`}
        confirmLabel="Confirm Cancel"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleConfirmDelete()}
        loading={isDeleting}
      />

      <ConfirmationModal
        open={bulkDeleteOpen}
        title="Permanently Delete Orders"
        message={`Permanently remove ${selectedOrderIds.length} selected order record(s)? This cannot be undone.`}
        confirmLabel="Delete Forever"
        onCancel={() => setBulkDeleteOpen(false)}
        onConfirm={() => void handleConfirmBulkDelete()}
        loading={isDeleting}
      />

      <PortalModal
        open={Boolean(editOrder)}
        onClose={() => setEditOrder(null)}
        title="Update Order Status"
        description="Only status, reason, and tracking fields are saved to the API."
        size="lg"
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setEditOrder(null)}
              className="inline-flex items-center justify-center rounded-xl border border-gray-100 bg-white px-4 py-2 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSaveEditOrder()}
              className="inline-flex items-center justify-center rounded-xl border border-primary bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#233f7d]"
            >
              Save Changes
            </button>
          </div>
        }
      >
        {editOrder ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-100 bg-[#fbfdff] px-4 py-3">
              <p className="text-sm font-bold text-gray-900">{editOrder.orderId}</p>
              <p className="mt-1 text-xs text-[#7b8cad]">{editOrder.customerName}</p>
            </div>

            <label className="space-y-1">
              <span className="text-xs font-semibold text-gray-500">Order Status</span>
              <select
                value={editStatus}
                onChange={(event) => setEditStatus(event.target.value as OrderStatusLabel)}
                className="h-10 w-full rounded-lg border border-gray-100 bg-white px-3 text-sm font-semibold text-[#2b467c] outline-none transition-colors focus:border-[#89addd]"
              >
                <option value="Pending">Pending</option>
                <option value="Payment Completed">Payment Completed</option>
                <option value="Processing">Processing</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold text-gray-500">Tracking carrier</span>
              <input
                type="text"
                value={editTrackingCarrier}
                onChange={(event) => setEditTrackingCarrier(event.target.value)}
                className="h-10 w-full rounded-lg border border-gray-100 bg-white px-3 text-sm font-semibold text-[#2b467c] outline-none transition-colors focus:border-[#89addd]"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold text-gray-500">Tracking number</span>
              <input
                type="text"
                value={editTrackingNumber}
                onChange={(event) => setEditTrackingNumber(event.target.value)}
                className="h-10 w-full rounded-lg border border-gray-100 bg-white px-3 text-sm font-semibold text-[#2b467c] outline-none transition-colors focus:border-[#89addd]"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold text-gray-500">Tracking URL</span>
              <input
                type="url"
                value={editTrackingUrl}
                onChange={(event) => setEditTrackingUrl(event.target.value)}
                className="h-10 w-full rounded-lg border border-gray-100 bg-white px-3 text-sm font-semibold text-[#2b467c] outline-none transition-colors focus:border-[#89addd]"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold text-gray-500">Reason / notes</span>
              <textarea
                rows={3}
                value={editNotes}
                onChange={(event) => setEditNotes(event.target.value)}
                className="w-full rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm font-semibold text-[#2b467c] outline-none transition-colors focus:border-[#89addd]"
              />
            </label>
          </div>
        ) : null}
      </PortalModal>

      <PortalModal
        open={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        title="Export Orders"
        description="Choose scope, filters, and output format."
        size="xl"
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setIsExportOpen(false)}
              className="inline-flex items-center justify-center rounded-xl border border-gray-100 bg-white px-4 py-2 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmExport}
              className="inline-flex items-center justify-center rounded-xl border border-primary bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#233f7d]"
            >
              Export
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <section className="space-y-2">
            <p className="text-xs font-bold tracking-widest text-gray-500">EXPORT SCOPE</p>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-gray-100 bg-[#fbfdff] px-3 py-2.5">
              <input
                type="radio"
                name="exportScope"
                checked={exportScope === "all_records"}
                onChange={() => setExportScope("all_records")}
                className="h-4 w-4 accent-[#2a4d98]"
              />
              <span className="text-sm font-semibold text-gray-900">
                All Records (respect current table filters)
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-gray-100 bg-[#fbfdff] px-3 py-2.5">
              <input
                type="radio"
                name="exportScope"
                checked={exportScope === "specific_records"}
                onChange={() => setExportScope("specific_records")}
                className="h-4 w-4 accent-[#2a4d98]"
              />
              <span className="text-sm font-semibold text-gray-900">Specific Records</span>
            </label>
          </section>

          <section
            className={`space-y-3 rounded-xl border border-gray-100 p-4 ${
              exportScope === "specific_records" ? "bg-white" : "bg-[#f7fafe] opacity-70"
            }`}
          >
            <label className="space-y-1">
              <span className="text-xs font-semibold text-gray-500">Date Range</span>
              <select
                value={exportDatePreset}
                onChange={(event) => setExportDatePreset(event.target.value as DateRangePreset)}
                disabled={exportScope !== "specific_records"}
                className="h-10 w-full rounded-lg border border-gray-100 bg-white px-3 text-sm font-semibold text-[#2b467c] outline-none transition-colors focus:border-[#89addd] disabled:cursor-not-allowed"
              >
                <option value="all_time">All Time</option>
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="this_week">This Week</option>
                <option value="this_month">This Month</option>
                <option value="custom">Custom Range</option>
              </select>
            </label>

            {exportDatePreset === "custom" ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-gray-500">Start Date</span>
                  <input
                    type="date"
                    value={exportCustomStartDate}
                    onChange={(event) => setExportCustomStartDate(event.target.value)}
                    disabled={exportScope !== "specific_records"}
                    className="h-10 w-full rounded-lg border border-gray-100 bg-white px-3 text-sm font-semibold text-[#2b467c] outline-none transition-colors focus:border-[#89addd] disabled:cursor-not-allowed"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-gray-500">End Date</span>
                  <input
                    type="date"
                    value={exportCustomEndDate}
                    onChange={(event) => setExportCustomEndDate(event.target.value)}
                    disabled={exportScope !== "specific_records"}
                    className="h-10 w-full rounded-lg border border-gray-100 bg-white px-3 text-sm font-semibold text-[#2b467c] outline-none transition-colors focus:border-[#89addd] disabled:cursor-not-allowed"
                  />
                </label>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold text-gray-500">Status</span>
                <select
                  value={exportStatusFilter}
                  onChange={(event) =>
                    setExportStatusFilter(event.target.value as "all" | OrderStatusLabel)
                  }
                  disabled={exportScope !== "specific_records"}
                  className="h-10 w-full rounded-lg border border-gray-100 bg-white px-3 text-sm font-semibold text-[#2b467c] outline-none transition-colors focus:border-[#89addd] disabled:cursor-not-allowed"
                >
                  <option value="all">All Status</option>
                  <option value="Pending">Pending</option>
                  <option value="Payment Completed">Payment Completed</option>
                  <option value="Processing">Processing</option>
                  <option value="Completed">Completed</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-gray-500">Customer Type</span>
                <select
                  value={exportTypeFilter}
                  onChange={(event) =>
                    setExportTypeFilter(event.target.value as "all" | CustomerType)
                  }
                  disabled={exportScope !== "specific_records"}
                  className="h-10 w-full rounded-lg border border-gray-100 bg-white px-3 text-sm font-semibold text-[#2b467c] outline-none transition-colors focus:border-[#89addd] disabled:cursor-not-allowed"
                >
                  <option value="all">All Types</option>
                  <option value="User">User</option>
                  <option value="Company">Company</option>
                  <option value="Admin">Admin</option>
                </select>
              </label>
            </div>
          </section>

          <section className="space-y-2">
            <p className="text-xs font-bold tracking-widest text-gray-500">FORMAT</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(["csv", "xlsx", "pdf"] as ExportFormat[]).map((format) => (
                <label
                  key={format}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-gray-100 bg-[#fbfdff] px-3 py-2.5"
                >
                  <input
                    type="radio"
                    name="exportFormat"
                    checked={exportFormat === format}
                    onChange={() => setExportFormat(format)}
                    className="h-4 w-4 accent-[#2a4d98]"
                  />
                  <span className="text-sm font-semibold text-gray-900">
                    {format === "xlsx" ? "Excel (.xlsx)" : format.toUpperCase()}
                  </span>
                </label>
              ))}
            </div>
          </section>
        </div>
      </PortalModal>
    </section>
  );
}
