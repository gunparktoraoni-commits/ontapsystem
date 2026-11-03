"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Info, Pencil, Trash2 } from "lucide-react";
import { formatDate, formatPeso, type OrderRecord } from "./orderMappers";
import { statusBadgeClass } from "./orderStatus";

type OrdersListProps = {
  loading: boolean;
  orders: OrderRecord[];
  selectedOrderIds: string[];
  highlightedOrderIds: string[];
  allVisibleSelected: boolean;
  onToggleSelectAll: () => void;
  onToggleRow: (id: string) => void;
  onOpenDetails: (order: OrderRecord) => void;
  onEdit: (order: OrderRecord) => void;
  onDelete: (order: OrderRecord) => void;
};

export default function OrdersList({
  loading,
  orders,
  selectedOrderIds,
  highlightedOrderIds,
  allVisibleSelected,
  onToggleSelectAll,
  onToggleRow,
  onOpenDetails,
  onEdit,
  onDelete,
}: OrdersListProps) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm orders-print-surface">
      <table className="min-w-[860px] w-full border-collapse orders-print-table">
        <thead>
          <tr className="border-b border-[#e8eef8] bg-[#fbfdff] text-left text-xs font-bold uppercase tracking-wide text-[#53658a]">
            <th className="w-12 px-4 py-3 orders-print-hide">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={onToggleSelectAll}
                className="h-4 w-4 rounded border-[#c8d7ed]"
                aria-label="Select all visible orders"
              />
            </th>
            <th className="px-4 py-3">Order ID</th>
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Customer</th>
            <th className="px-4 py-3 text-right">Amount</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-center orders-print-hide">Actions</th>
          </tr>
        </thead>
        <tbody>
          <AnimatePresence initial={false}>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-14 text-center text-sm font-semibold text-gray-500">
                  Loading orders...
                </td>
              </tr>
            ) : orders.length > 0 ? (
              orders.map((order) => {
                const highlighted = highlightedOrderIds.includes(order.id);
                return (
                  <motion.tr
                    key={order.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.3 }}
                    className="border-b border-[#edf3fb] text-sm text-[#4f638a] hover:bg-[#fafcff]"
                  >
                    <td className="px-4 py-3.5 orders-print-hide">
                      <input
                        type="checkbox"
                        checked={selectedOrderIds.includes(order.id)}
                        onChange={() => onToggleRow(order.id)}
                        className="h-4 w-4 rounded border-[#c8d7ed]"
                        aria-label={`Select ${order.orderId}`}
                      />
                    </td>
                    <td className="px-4 py-3.5">
                      <button
                        type="button"
                        onClick={() => onOpenDetails(order)}
                        className="text-left font-semibold text-primary underline decoration-[#2a4d98]/35 underline-offset-3 hover:text-[#233f7d]"
                      >
                        {order.orderId}
                      </button>
                    </td>
                    <td className="px-4 py-3.5 text-gray-500">{formatDate(order.dateIso)}</td>
                    <td className="px-4 py-3.5">
                      <p className="font-semibold text-gray-900">{order.customerName}</p>
                      <p className="mt-0.5 text-xs text-[#7b8cad]">{order.customerEmail}</p>
                    </td>
                    <td className="px-4 py-3.5 text-right font-bold text-gray-900">
                      {formatPeso(order.amount)}
                    </td>
                    <td className="px-4 py-3.5">
                      <motion.span
                        animate={highlighted ? { scale: [1, 1.06, 1] } : { scale: 1 }}
                        transition={{ duration: 0.4 }}
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(order.status)}`}
                      >
                        {order.status}
                      </motion.span>
                    </td>
                    <td className="px-4 py-3.5 orders-print-hide">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onEdit(order)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#6a7a98] transition-colors hover:bg-[#edf3ff] hover:text-[#3f5f94]"
                          title="Update status"
                          aria-label={`Edit ${order.orderId}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(order)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#6a7a98] transition-colors hover:bg-[#fff1f1] hover:text-[#b75c5c]"
                          title="Cancel order"
                          aria-label={`Cancel ${order.orderId}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenDetails(order)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#6a7a98] transition-colors hover:bg-[#edf3ff] hover:text-[#3f5f94]"
                          title="View order details"
                          aria-label={`View ${order.orderId}`}
                        >
                          <Info className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={7} className="px-4 py-14 text-center text-sm font-semibold text-gray-500">
                  No orders found for the selected filters.
                </td>
              </tr>
            )}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  );
}
