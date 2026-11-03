"use client";

import { useMemo, useState } from "react";
import { OrderClientAvatar, type ClientOrderRow } from "./ClientOrdersList";
import {
  BOARD_SCROLLBAR_CLASS,
  COLUMN_SCROLLBAR_CLASS,
  KANBAN_COLUMNS,
  normalizeOrderToColumn,
  type StaffOrderColumn,
} from "./orderStatus";
import { InlineLoader } from "@/app/components/Loader";

type ClientOrdersKanbanProps = {
  loading: boolean;
  orders: ClientOrderRow[];
  dragging: boolean;
  onDragStart: (orderId: string) => void;
  onDragEnd: () => void;
  onDrop: (orderId: string, column: StaffOrderColumn) => void;
  onOpenOrder?: (orderId: string) => void;

};

export default function ClientOrdersKanban({
  loading,
  orders,
  dragging,
  onDragStart,
  onDragEnd,
  onDrop,
  onOpenOrder,
}: ClientOrdersKanbanProps) {
  const [dragOverColumn, setDragOverColumn] = useState<StaffOrderColumn | null>(null);

  const groupedOrders = useMemo(() => {
    const groups: Record<StaffOrderColumn, ClientOrderRow[]> = {
      pending: [],
      processed: [],
      ready_for_pickup: [],
      completed: [],
      cancelled: [],
    };

    for (const order of orders) {
      const column = normalizeOrderToColumn(order.status);
      if (column === "cancelled") continue;
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
        {KANBAN_COLUMNS.map((column) => (
          <div
            key={column.key}
            className={`w-72 shrink-0 rounded-2xl bg-[#E8EEF8] p-3 min-h-[28rem] transition-colors ${
              dragOverColumn === column.key ? "ring-2 ring-[#4785B8]/40" : ""
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOverColumn(column.key);
            }}
            onDragLeave={() => setDragOverColumn(null)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOverColumn(null);
              const orderId = event.dataTransfer.getData("text/order-id");
              if (orderId) onDrop(orderId, column.key);
            }}
          >
            <h3 className="px-2 py-2 text-sm font-semibold text-gray-700">{column.label}</h3>
            <div className={`space-y-3 max-h-[calc(100vh-22rem)] pr-1 ${COLUMN_SCROLLBAR_CLASS}`}>
              {groupedOrders[column.key].length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#C8D4EB] bg-white/60 px-3 py-8 text-center text-xs text-gray-500">
                  No orders
                </div>
              ) : (
                groupedOrders[column.key].map((order) => (
                  <article
                    key={order.shop_order_id}
                    draggable={!dragging}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/order-id", order.shop_order_id);
                      event.dataTransfer.effectAllowed = "move";
                      onDragStart(order.shop_order_id);
                    }}
                    onDragEnd={onDragEnd}
                    onClick={() => onOpenOrder?.(order.shop_order_id)}
                    className="rounded-xl border border-gray-200 bg-white shadow-sm cursor-grab active:cursor-grabbing"
                  >
                    <div className="px-4 py-4 min-h-[4.5rem]">
                      <p className="text-xs font-semibold text-gray-500">#{order.order_number}</p>
                      <p className="text-sm font-medium text-gray-800 mt-1 line-clamp-2">
                        {order.transaction}
                      </p>
                      <p className="text-xs text-[#4785B8] font-semibold mt-2">
                        ₱{Number(order.total_amount).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div className="border-t border-gray-100 px-4 py-3 flex items-center gap-3">
                      <OrderClientAvatar
                        name={order.client_name}
                        avatarUrl={order.client_avatar_url}
                        size="sm"
                      />
                      <p className="text-sm font-medium text-gray-700 truncate">{order.client_name}</p>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
    
  );

}
