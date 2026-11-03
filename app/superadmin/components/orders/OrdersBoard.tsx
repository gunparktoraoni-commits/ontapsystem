"use client";

import { useMemo, useState } from "react";
import { InlineLoader } from "@/app/components/Loader";
import { formatPeso, type OrderRecord } from "./orderMappers";
import {
  BOARD_SCROLLBAR_CLASS,
  COLUMN_SCROLLBAR_CLASS,
  KANBAN_COLUMNS,
  canTransitionStatus,
  normalizeOrderToColumn,
  statusBadgeClass,
  type SuperAdminOrderColumn,
} from "./orderStatus";

type OrdersBoardProps = {
  loading: boolean;
  orders: OrderRecord[];
  dragging: boolean;
  highlightedOrderIds?: string[];
  onDragStart: (orderId: string) => void;
  onDragEnd: () => void;
  onDrop: (orderId: string, column: SuperAdminOrderColumn) => void;
  onOpenOrder: (order: OrderRecord) => void;
};

export default function OrdersBoard({
  loading,
  orders,
  dragging,
  highlightedOrderIds = [],
  onDragStart,
  onDragEnd,
  onDrop,
  onOpenOrder,
}: OrdersBoardProps) {
  const [dragOverColumn, setDragOverColumn] = useState<SuperAdminOrderColumn | null>(null);
  const [draggingFrom, setDraggingFrom] = useState<SuperAdminOrderColumn | null>(null);

  const groupedOrders = useMemo(() => {
    const groups: Record<SuperAdminOrderColumn, OrderRecord[]> = {
      pending: [],
      paid: [],
      processed: [],
      completed: [],
      cancelled: [],
    };

    for (const order of orders) {
      const column = normalizeOrderToColumn(order.status);
      groups[column].push(order);
    }

    return groups;
  }, [orders]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <InlineLoader />
      </div>
    );
  }

  return (
    <div className={`pb-2 ${BOARD_SCROLLBAR_CLASS}`}>
      <div className="flex gap-4 min-w-max">
        {KANBAN_COLUMNS.map((column) => {
          const acceptsDrop =
            !draggingFrom ||
            draggingFrom === column.key ||
            canTransitionStatus(draggingFrom, column.key);

          return (
            <div
              key={column.key}
              className={`w-72 shrink-0 rounded-2xl bg-[#E8EEF8] p-3 min-h-[28rem] transition-colors ${
                dragOverColumn === column.key && acceptsDrop
                  ? "ring-2 ring-[#4785B8]/40"
                  : ""
              } ${dragging && !acceptsDrop ? "opacity-60" : ""}`}
              onDragOver={(event) => {
                if (!acceptsDrop) return;
                event.preventDefault();
                setDragOverColumn(column.key);
              }}
              onDragLeave={() => setDragOverColumn(null)}
              onDrop={(event) => {
                event.preventDefault();
                setDragOverColumn(null);
                setDraggingFrom(null);
                if (!acceptsDrop) return;
                const orderId = event.dataTransfer.getData("text/order-id");
                if (orderId) onDrop(orderId, column.key);
              }}
            >
              <div className="flex items-center justify-between px-2 py-2">
                <h3 className="text-sm font-semibold text-gray-700">{column.label}</h3>
                <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-semibold text-[#4785B8]">
                  {groupedOrders[column.key].length}
                </span>
              </div>
              <div className={`space-y-3 max-h-[calc(100vh-22rem)] pr-1 ${COLUMN_SCROLLBAR_CLASS}`}>
                {groupedOrders[column.key].length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#C8D4EB] bg-white/60 px-3 py-8 text-center text-xs text-gray-500">
                    No orders
                  </div>
                ) : (
                  groupedOrders[column.key].map((order) => {
                    const highlighted = highlightedOrderIds.includes(order.id);
                    return (
                      <article
                        key={order.id}
                        draggable={!dragging}
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/order-id", order.id);
                          event.dataTransfer.effectAllowed = "move";
                          setDraggingFrom(normalizeOrderToColumn(order.status));
                          onDragStart(order.id);
                        }}
                        onDragEnd={() => {
                          setDraggingFrom(null);
                          onDragEnd();
                        }}
                        onClick={() => onOpenOrder(order)}
                        className={`rounded-xl border bg-white shadow-sm cursor-grab active:cursor-grabbing transition-shadow ${
                          highlighted
                            ? "border-[#4785B8] ring-2 ring-[#4785B8]/25"
                            : "border-gray-200"
                        }`}
                      >
                        <div className="px-4 py-4 min-h-[4.5rem]">
                          <p className="text-xs font-semibold text-gray-500">#{order.orderId}</p>
                          <p className="text-sm font-medium text-gray-800 mt-1 line-clamp-2">
                            {order.itemsSummary}
                          </p>
                          <p className="text-xs text-[#4785B8] font-semibold mt-2">
                            {formatPeso(order.amount)}
                          </p>
                          <span
                            className={`mt-3 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadgeClass(order.status)}`}
                          >
                            {order.status}
                          </span>
                        </div>
                        <div className="border-t border-gray-100 px-4 py-3">
                          <p className="text-sm font-medium text-gray-700 truncate">
                            {order.customerName}
                          </p>
                          <p className="text-xs text-gray-500 truncate">{order.customerEmail}</p>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
