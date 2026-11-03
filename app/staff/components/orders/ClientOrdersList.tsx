"use client";

import { useState } from "react";
import { getInitials } from "../messages/messagesUtils";
import { formatStatusLabel } from "./orderStatus";
import { InlineLoader } from "@/app/components/Loader";

export interface ClientOrderRow {
  shop_order_id: string;
  order_number: string;
  user_id?: string;
  client_name: string;
  client_avatar_url?: string | null;
  transaction: string;
  quantity: number;
  total_amount: string;
  status: string;
  created_at: string;
}

export function OrderClientAvatar({
  name,
  avatarUrl,
  size = "md",
}: {
  name: string;
  avatarUrl?: string | null;
  size?: "sm" | "md";
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const sizeClasses = size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm";
  const safeUrl = avatarUrl?.trim();

  if (safeUrl && !imgFailed) {
    return (
      <img
        src={safeUrl}
        alt={name}
        className={`${sizeClasses} shrink-0 rounded-full object-cover border border-gray-100 bg-white`}
        onError={() => setImgFailed(true)}
      />
    );
  }

  return (
    <div
      className={`${sizeClasses} shrink-0 rounded-full bg-[#4785B8] text-white font-semibold flex items-center justify-center`}
      aria-hidden
    >
      {getInitials(name)}
    </div>
  );
}

type ClientOrdersListProps = {
  loading: boolean;
  orders: ClientOrderRow[];
  onOpenOrder?: (orderId: string) => void;
};

export default function ClientOrdersList({ loading, orders, onOpenOrder }: ClientOrdersListProps) {
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <InlineLoader />
      </div>
    );
  }

  if (orders.length === 0) {
    return <p className="text-sm text-gray-500 text-center py-16">No client orders found.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
            <th className="px-5 py-4">Client Name</th>
            <th className="px-5 py-4">Transaction</th>
            <th className="px-5 py-4">Quantity</th>
            <th className="px-5 py-4">Amount</th>
            <th className="px-5 py-4">Status</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr
              key={order.shop_order_id}
              className={`transition-colors ${onOpenOrder ? "cursor-pointer hover:bg-gray-50/80" : "hover:bg-gray-50/80"}`}
              onClick={() => onOpenOrder?.(order.shop_order_id)}
            >
              <td className="px-5 py-5">
                <div className="flex items-center gap-3">
                  <OrderClientAvatar
                    name={order.client_name}
                    avatarUrl={order.client_avatar_url}
                  />
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">{order.client_name}</p>
                    <p className="text-xs text-gray-400 mt-1">#{order.order_number}</p>
                  </div>
                </div>
              </td>
              <td className="px-5 py-5 text-sm text-gray-700">{order.transaction}</td>
              <td className="px-5 py-5 text-sm text-gray-700">{order.quantity}</td>
              <td className="px-5 py-5 text-sm font-semibold text-[#2A4792]">
                ₱{Number(order.total_amount).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </td>
              <td className="px-5 py-5 text-sm font-medium text-gray-700 capitalize">
                {formatStatusLabel(order.status)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
