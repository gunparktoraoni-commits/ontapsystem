export type OrderReceiptItem = {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
};

export type OrderReceiptData = {
  receipt_id: string;
  order_id: string;
  order_number: string;
  date: string;
  status: string;
  currency: string;
  total: number;
  formatted_total: string;
  invoice_number: string;
  items: OrderReceiptItem[];
  subtotal: number;
  tax: number;
  shipping: number;
  discount: number;
  customer: { name: string; email: string };
  payment_method: { type: string; brand: string | null };
  business: {
    name: string;
    email: string;
    phone: string | null;
    address: string | null;
    tax_id: string | null;
  };
};

export type UserOrderListItem = {
  id: string;
  orderNumber: string;
  date: string;
  status: string;
  total: number;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  items: Array<{
    id: number;
    name: string;
    price: number;
    quantity: number;
  }>;
};

export function formatOrderMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function formatOrderDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Human-friendly label for a raw order status. "paid" is surfaced as
// "Payment Completed" so it is clearly distinct from a finished ("Completed") order.
export function orderStatusLabel(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "paid") return "Payment Completed";
  if (normalized === "pending_payment") return "Pending Payment";
  if (normalized === "payment_failed") return "Payment Failed";
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function orderStatusClasses(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "completed") {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (normalized === "paid") {
    return "bg-blue-50 text-blue-700 border-blue-200";
  }
  if (normalized === "pending" || normalized === "pending_payment" || normalized === "processing") {
    return "bg-amber-50 text-amber-700 border-amber-200";
  }
  if (normalized === "failed" || normalized === "cancelled" || normalized === "payment_failed") {
    return "bg-red-50 text-red-700 border-red-200";
  }
  return "bg-gray-50 text-gray-600 border-gray-200";
}

import { exportElementAsPng } from "./exportImage";

export { exportElementAsPng };

export async function exportReceiptAsPng(
  element: HTMLElement,
  fileName: string,
): Promise<void> {
  return exportElementAsPng(element, fileName);
}
