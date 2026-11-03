import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { formatBillingAmount } from "@/server/lib/billing/history";
import {
  buildUserShopOrderWhere,
  parseShopOrderIdentifier,
} from "@/server/lib/marketplace/shop-order-access";

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

/** Narrow select — avoids full-row reads that break when unused columns drift. */
const receiptOrderSelect = {
  id: true,
  order_number: true,
  status: true,
  currency: true,
  subtotal: true,
  tax_amount: true,
  shipping_amount: true,
  discount_amount: true,
  total_amount: true,
  payment_method: true,
  xendit_payment_method: true,
  placed_at: true,
  items: {
    select: {
      item_name: true,
      quantity: true,
      unit_price: true,
      total_price: true,
    },
  },
} satisfies Prisma.ShopOrderSelect;

type ReceiptOrderRow = Prisma.ShopOrderGetPayload<{ select: typeof receiptOrderSelect }>;

function toSafeNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && "toNumber" in value) {
    try {
      const n = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(n) ? n : fallback;
    } catch {
      return fallback;
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toSafeIsoDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function mapOrderToReceipt(
  order: ReceiptOrderRow,
  customer: { name: string; email: string },
): OrderReceiptData {
  const currency = String(order.currency || "PHP").trim().toUpperCase() || "PHP";
  const subtotal = toSafeNumber(order.subtotal);
  const tax = toSafeNumber(order.tax_amount);
  const shipping = toSafeNumber(order.shipping_amount);
  const discount = toSafeNumber(order.discount_amount);
  const total = toSafeNumber(order.total_amount);

  return {
    receipt_id: `rcpt_order_${order.id.toString()}`,
    order_id: order.id.toString(),
    order_number: order.order_number,
    date: toSafeIsoDate(order.placed_at),
    status: order.status || "pending",
    currency,
    total,
    formatted_total: formatBillingAmount(total, currency),
    invoice_number: order.order_number,
    items: (order.items ?? []).map((item) => ({
      description: item.item_name || "Item",
      quantity: toSafeNumber(item.quantity, 1),
      unit_price: toSafeNumber(item.unit_price),
      amount: toSafeNumber(item.total_price),
    })),
    subtotal,
    tax,
    shipping,
    discount,
    customer,
    payment_method: {
      type: order.payment_method ?? "xendit",
      brand: order.xendit_payment_method ?? null,
    },
    business: {
      name: process.env.BILLING_BUSINESS_NAME ?? "OnTap",
      email: process.env.BILLING_BUSINESS_EMAIL ?? "billing@ontap.ph",
      phone: process.env.BILLING_BUSINESS_PHONE ?? null,
      address: process.env.BILLING_BUSINESS_ADDRESS ?? null,
      tax_id: process.env.BILLING_BUSINESS_TAX_ID ?? null,
    },
  };
}

function parseUserId(userId: bigint | number | string): bigint {
  if (typeof userId === "bigint") return userId;
  if (typeof userId === "number" && Number.isFinite(userId)) {
    return BigInt(Math.trunc(userId));
  }
  const asNumber = Number(userId);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return BigInt(Math.trunc(asNumber));
  }
  throw new Error(`Invalid user id for receipt lookup: ${String(userId)}`);
}

export async function getShopOrderReceipt(
  userId: bigint | number | string,
  orderIdentifier: string,
): Promise<OrderReceiptData | null> {
  const normalizedUserId = parseUserId(userId);
  const { trimmed } = parseShopOrderIdentifier(orderIdentifier);
  if (!trimmed) return null;

  const order = await prisma.shopOrder.findFirst({
    where: buildUserShopOrderWhere(normalizedUserId, trimmed),
    select: receiptOrderSelect,
  });

  if (!order) return null;

  const user = await prisma.user.findUnique({
    where: { user_id: normalizedUserId },
    select: { first_name: true, last_name: true, email: true },
  });
  if (!user?.email) return null;

  const customerName = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
  return mapOrderToReceipt(order, {
    name: customerName || "Customer",
    email: user.email,
  });
}
