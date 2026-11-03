"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Filter, Search } from "lucide-react";
import { SectionLoader, InlineLoader } from "../../components/Loader";
import { getFrontendApiBaseUrl } from "../../components/apiBase";
import { buildAuthHeaders } from "./StaffBizCardPanels";
import ClientOrdersKanban from "./orders/ClientOrdersKanban";
import ClientOrdersList, { type ClientOrderRow } from "./orders/ClientOrdersList";
import ClientOrderDetailDrawer from "./orders/ClientOrderDetailDrawer";
import {
  STATUS_FILTER_CARDS,
  type StaffOrderColumn,
} from "./orders/orderStatus";
import type { SupportConversation } from "@/app/lib/supportMessaging";

const API = getFrontendApiBaseUrl();
const POLL_INTERVAL_MS = 10000;
const SEARCH_DEBOUNCE_MS = 350;

async function fetchClientAvatarMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const response = await fetch("/api/staff/support/conversations", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return map;
    const payload = await response.json().catch(() => null);
    const conversations = (payload?.data ?? []) as SupportConversation[];
    for (const conv of conversations) {
      const userId = conv.clientUserId?.trim();
      const profileUrl = conv.client?.profileUrl?.trim();
      if (userId && profileUrl) {
        map.set(userId, profileUrl);
      }
    }
  } catch {
    // avatar enrichment is best-effort
  }
  return map;
}

function enrichOrdersWithAvatars(
  orders: ClientOrderRow[],
  avatarMap: Map<string, string>,
): ClientOrderRow[] {
  return orders.map((order) => {
    const userId = order.user_id?.trim();
    const avatarFromMap = userId ? avatarMap.get(userId) : undefined;
    return {
      ...order,
      client_avatar_url: avatarFromMap ?? order.client_avatar_url ?? null,
    };
  });
}

type ViewMode = "list" | "kanban";

type StatusCounts = Record<StaffOrderColumn, number>;

export default function ClientOrders() {
  const [initialLoading, setInitialLoading] = useState(true);
  const [orders, setOrders] = useState<ClientOrderRow[]>([]);
  const [statusCounts, setStatusCounts] = useState<StatusCounts>({
    pending: 0,
    processed: 0,
    ready_for_pickup: 0,
    completed: 0,
    cancelled: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StaffOrderColumn | "all">("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [drawerRefreshKey, setDrawerRefreshKey] = useState(0);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const updatingOrderIdRef = useRef<string | null>(null);
  const hasLoadedOnceRef = useRef(false);

  useEffect(() => {
    draggingRef.current = dragging;
  }, [dragging]);

  useEffect(() => {
    updatingOrderIdRef.current = updatingOrderId;
  }, [updatingOrderId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadOrders = useCallback(async (options?: { silent?: boolean }) => {
    if (draggingRef.current || updatingOrderIdRef.current) return;
    const silent = options?.silent ?? hasLoadedOnceRef.current;
    if (!silent) setInitialLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (debouncedSearch) params.set("search", debouncedSearch);

      const [response, avatarMap] = await Promise.all([
        fetch(`${API}/api/staff/portal/orders?${params}`, {
          credentials: "include",
          headers: buildAuthHeaders(),
        }),
        fetchClientAvatarMap(),
      ]);
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to load client orders.");
      }

      const rawOrders = (payload?.data?.orders ?? []) as ClientOrderRow[];
      setOrders(enrichOrdersWithAvatars(rawOrders, avatarMap));
      if (payload?.data?.status_counts) {
        setStatusCounts(payload.data.status_counts as StatusCounts);
      }
      hasLoadedOnceRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load client orders.");
    } finally {
      setInitialLoading(false);
    }
  }, [debouncedSearch, statusFilter]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadOrders({ silent: true });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [loadOrders]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (viewMenuRef.current && !viewMenuRef.current.contains(event.target as Node)) {
        setViewMenuOpen(false);
      }
      if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) {
        setFilterMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleExport = () => {
    if (orders.length === 0) return;
    const headers = [
      "Order Number",
      "Client Name",
      "Transaction",
      "Quantity",
      "Amount",
      "Status",
      "Created At",
    ];
    const rows = orders.map((order) => [
      order.order_number,
      order.client_name,
      order.transaction,
      String(order.quantity),
      order.total_amount,
      order.status,
      order.created_at,
    ]);
    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((value) => {
            const stringValue = String(value ?? "");
            if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
              return `"${stringValue.replace(/"/g, '""')}"`;
            }
            return stringValue;
          })
          .join(","),
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `client-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const updateOrderStatus = async (orderId: string, status: StaffOrderColumn) => {
    setUpdatingOrderId(orderId);
    const previousOrders = orders;
    setOrders((current) =>
      current.map((order) =>
        order.shop_order_id === orderId ? { ...order, status } : order,
      ),
    );

    try {
      const response = await fetch(`${API}/api/staff/portal/orders/${orderId}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeaders(),
        },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to update order status.");
      }
      await loadOrders();
      setDrawerRefreshKey((value) => value + 1);
    } catch (err) {
      setOrders(previousOrders);
      setError(err instanceof Error ? err.message : "Failed to update order status.");
    } finally {
      setUpdatingOrderId(null);
      setDragging(false);
    }
  };

  const activeFilterLabel = useMemo(() => {
    if (statusFilter === "all") return "All Orders";
    return STATUS_FILTER_CARDS.find((card) => card.key === statusFilter)?.label ?? "Filtered";
  }, [statusFilter]);

  if (initialLoading && orders.length === 0) {
    return <SectionLoader text="Loading client orders..." />;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-[#2A4792]">Client Orders</h2>
        <button
          type="button"
          onClick={handleExport}
          className="rounded-xl bg-[#E8F0FC] px-4 py-2 text-sm font-semibold text-[#2A4792] hover:bg-[#dbe7f8] transition-colors"
        >
          Export
        </button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {STATUS_FILTER_CARDS.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={() => setStatusFilter(card.key)}
            className={`rounded-2xl border bg-white px-4 py-4 text-left shadow-sm transition-all ${
              statusFilter === card.key
                ? "border-[#4785B8] ring-2 ring-[#4785B8]/20"
                : "border-gray-100 hover:border-[#C8D4EB]"
            }`}
          >
            <p className="text-xs font-semibold text-gray-500">{card.label}</p>
            <p className="mt-2 text-2xl font-black text-gray-900">{statusCounts[card.key]}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search"
            className="w-full rounded-xl border border-gray-200 bg-white pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4785B8]/30"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="relative" ref={viewMenuRef}>
            <button
              type="button"
              onClick={() => {
                setFilterMenuOpen(false);
                setViewMenuOpen((value) => !value);
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {viewMode === "list" ? "List" : "Kanban"}
              <ChevronDown className="h-4 w-4" />
            </button>
            {viewMenuOpen && (
              <div className="absolute right-0 z-20 mt-2 w-36 rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setViewMode("list");
                    setViewMenuOpen(false);
                  }}
                  className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
                >
                  List
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewMode("kanban");
                    setViewMenuOpen(false);
                  }}
                  className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
                >
                  Kanban
                </button>
              </div>
            )}
          </div>

          <div className="relative" ref={filterMenuRef}>
            <button
              type="button"
              onClick={() => {
                setViewMenuOpen(false);
                setFilterMenuOpen((value) => !value);
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Filter className="h-4 w-4" />
              Filter
            </button>
            {filterMenuOpen && (
              <div className="absolute right-0 z-20 mt-2 w-52 rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter("all");
                    setFilterMenuOpen(false);
                  }}
                  className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
                >
                  All Orders
                </button>
                {STATUS_FILTER_CARDS.map((card) => (
                  <button
                    key={card.key}
                    type="button"
                    onClick={() => {
                      setStatusFilter(card.key);
                      setFilterMenuOpen(false);
                    }}
                    className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    {card.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="rounded-3xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="text-sm text-gray-500">{activeFilterLabel}</p>
          {updatingOrderId ? <InlineLoader /> : null}
        </div>

        {viewMode === "list" ? (
          <ClientOrdersList
            loading={false}
            orders={orders}
            onOpenOrder={(orderId) => setSelectedOrderId(orderId)}
          />
        ) : (
          <div className="p-4">
            <ClientOrdersKanban
              loading={false}
              orders={orders}
              dragging={dragging || Boolean(updatingOrderId)}
              onDragStart={() => setDragging(true)}
              onDragEnd={() => setDragging(false)}
              onDrop={(orderId, column) => void updateOrderStatus(orderId, column)}
              onOpenOrder={(orderId) => setSelectedOrderId(orderId)}
            />
          </div>
        )}
      </div>

      <ClientOrderDetailDrawer
        open={Boolean(selectedOrderId)}
        orderId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
        onStatusChange={updateOrderStatus}
        refreshKey={drawerRefreshKey}
      />
    </div>
  );
}
