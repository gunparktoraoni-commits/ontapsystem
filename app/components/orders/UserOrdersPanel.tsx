//app/components/orders/UserOrdersPanel.tsx

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Package, Receipt } from "lucide-react";
import { getFrontendApiBaseUrl } from "../apiBase";
import {
  formatOrderDate,
  formatOrderMoney,
  orderStatusClasses,
  orderStatusLabel,
  type UserOrderListItem,
} from "../../lib/orderReceipt";
import { SectionLoader } from "../Loader"; // <-- added import

const API = getFrontendApiBaseUrl();

export default function UserOrdersPanel() {
  const [orders, setOrders] = useState<UserOrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/marketplace/orders?limit=50`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((payload?.error as string) || "Unable to load orders.");
      }
      const list = (payload?.data?.orders ?? []) as UserOrderListItem[];
      setOrders(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load orders.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  // ------------------------------------------------------------------
  // Loading: show full‑page overlay
  // ------------------------------------------------------------------
  // if (loading) {
  //   return (
  //     <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white/80 backdrop-blur-sm">
  //       <SectionLoader text="Loading your orders..." />
  //     </div>
  //   );
  // }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm text-red-700">{error}</p>
        <button
          type="button"
          onClick={() => void loadOrders()}
          className="mt-4 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
        >
          Retry
        </button>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-2xl border border-[#d8deee] bg-white p-8 text-center text-gray-500 relative">
        {loading && 
          <div className="absolute inset-0 z-[9999] flex items-center justify-center bg-white">
            <SectionLoader text="Loading your orders..." />
          </div>
        }
        <Package className="h-10 w-10 opacity-30" />
        <p className="text-sm font-medium">No orders yet</p>
        <p className="text-xs text-gray-400">
          Your marketplace purchases will appear here after checkout.
        </p>
        <Link
          href="/user/emarket"
          className="mt-2 rounded-xl bg-[#2D3A8C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#243074]"
        >
          Browse E-Market
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[#d8deee] bg-white shadow-sm relative">
      {loading && 
        <div className="absolute inset-0 z-[9999] flex items-center justify-center bg-white">
          <SectionLoader text="Loading your orders..." />
        </div>
      }
      <ul className="divide-y divide-gray-100">
        {orders.map((order) => (
          <li key={order.orderNumber}>
            <Link
              href={`/user/orders/${encodeURIComponent(order.orderNumber)}`}
              className="flex items-center gap-4 px-4 py-4 transition hover:bg-gray-50 sm:px-6"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#2D3A8C]/10">
                <Receipt className="h-5 w-5 text-[#2D3A8C]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-gray-900">
                    Order #{order.orderNumber}
                  </p>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${orderStatusClasses(order.status)}`}
                  >
                    {orderStatusLabel(order.status)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {formatOrderDate(order.date)} · {order.items.length} item
                  {order.items.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-sm font-semibold text-gray-900">
                  {formatOrderMoney(order.total, "PHP")}
                </span>
                <ChevronRight className="h-4 w-4 text-gray-400" />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}