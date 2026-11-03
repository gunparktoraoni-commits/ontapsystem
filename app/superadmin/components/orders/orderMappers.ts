import {
  normalizeOrderStatusLabel,
  type OrderStatusLabel,
} from "./orderStatus";

export type CustomerType = "User" | "Company" | "Admin";
export type PaymentMethod = "Xendit" | "PayPal" | "Stripe" | "Bank Transfer";

export interface OrderLineItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface OrderRecord {
  id: string;
  orderId: string;
  dateIso: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress: string;
  customerType: CustomerType;
  itemsSummary: string;
  lineItems: OrderLineItem[];
  paymentMethod: PaymentMethod;
  amount: number;
  status: OrderStatusLabel;
  notes: string;
  transactionId: string;
  shippingCarrier: string;
  trackingNumber: string;
  trackingUrl: string;
}

export interface OrderTimelineEvent {
  eventId: string;
  event: string;
  previousStatus: string | null;
  nextStatus: string;
  reason: string | null;
  changedAt: string;
  actorName: string | null;
  actorEmail: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCustomerType(value: unknown): CustomerType {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === "company") return "Company";
  if (raw === "admin" || raw === "superadmin" || raw === "super_admin") return "Admin";
  return "User";
}

function normalizePaymentMethod(value: unknown): PaymentMethod {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw.includes("paypal")) return "PayPal";
  if (raw.includes("stripe")) return "Stripe";
  if (raw.includes("bank")) return "Bank Transfer";
  return "Xendit";
}

export function formatAddressValue(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  const record = asRecord(value);
  if (!record) return "";
  const parts = [
    record.line1 ?? record.address_line1 ?? record.street,
    record.line2 ?? record.address_line2,
    record.barangay ?? record.brgy,
    record.city,
    record.province ?? record.region ?? record.state,
    record.postal_code ?? record.zip ?? record.zipcode,
    record.country,
  ]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean);
  return parts.join(", ");
}

export function formatPeso(amount: number): string {
  return `₱${Math.round(amount).toLocaleString("en-US")}`;
}

export function formatDate(dateIso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${dateIso}T00:00:00`));
}

export function mapOrderRecord(raw: Record<string, unknown>, index: number): OrderRecord {
  const user = asRecord(raw.user);
  const totals = asRecord(raw.totals);
  const payment = asRecord(raw.payment);
  const shipment = asRecord(raw.shipment);
  const addresses = asRecord(raw.addresses);

  const id = String(raw.id ?? raw.order_id ?? raw.orderId ?? raw.uuid ?? index + 1);
  const orderId = String(
    raw.order_number ?? raw.orderNumber ?? raw.reference ?? raw.id ?? `ORD-${index + 1}`,
  );
  const amount = toNumber(totals?.total_amount ?? raw.total_amount ?? raw.amount ?? raw.total ?? 0, 0);
  const status = normalizeOrderStatusLabel(raw.status ?? raw.order_status);
  const placedAtRaw = String(raw.placed_at ?? raw.created_at ?? raw.date ?? "").trim();
  const dateIso = placedAtRaw ? placedAtRaw.slice(0, 10) : new Date().toISOString().slice(0, 10);

  const lineItemsRaw = Array.isArray(raw.items)
    ? raw.items
    : Array.isArray(raw.line_items)
      ? raw.line_items
      : [];

  const lineItems: OrderLineItem[] = lineItemsRaw.map((item, lineIndex) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return {
      id: String(row.id ?? row.item_id ?? `${id}-${lineIndex + 1}`),
      name: String(
        row.item_name ?? row.name ?? row.title ?? row.product_name ?? `Item ${lineIndex + 1}`,
      ),
      quantity: toNumber(row.quantity ?? row.qty ?? 1, 1),
      unitPrice: toNumber(row.unit_price ?? row.price ?? row.amount ?? 0, 0),
    };
  });

  const firstName = typeof user?.first_name === "string" ? user.first_name.trim() : "";
  const lastName = typeof user?.last_name === "string" ? user.last_name.trim() : "";
  const nestedName = `${firstName} ${lastName}`.trim();
  const customerName = String(
    raw.customer_name ?? raw.full_name ?? raw.name ?? (nestedName || "Unknown Customer"),
  );
  const itemCount = toNumber(raw.item_count ?? lineItems.length, lineItems.length);

  return {
    id,
    orderId,
    dateIso,
    customerName: customerName.trim() || "Unknown Customer",
    customerEmail: String(raw.customer_email ?? raw.email ?? user?.email ?? ""),
    customerPhone: String(raw.customer_phone ?? raw.phone ?? user?.contact ?? user?.phone ?? ""),
    customerAddress: String(
      formatAddressValue(addresses?.shipping) ||
        formatAddressValue(raw.shipping_address) ||
        formatAddressValue(raw.address) ||
        "",
    ),
    customerType: normalizeCustomerType(raw.customer_type ?? raw.account_type ?? user?.role),
    itemsSummary: String(
      raw.items_summary ??
        raw.summary ??
        (itemCount > 0 ? `${itemCount} item${itemCount === 1 ? "" : "s"}` : "0 items"),
    ),
    lineItems,
    paymentMethod: normalizePaymentMethod(
      payment?.payment_method ?? raw.payment_method ?? raw.paymentMethod,
    ),
    amount,
    status,
    notes: String(raw.notes ?? raw.admin_notes ?? raw.status_note ?? ""),
    transactionId: String(
      payment?.payment_id ??
        payment?.xendit_payment_id ??
        raw.transaction_id ??
        raw.payment_reference ??
        "",
    ),
    shippingCarrier: String(
      shipment?.tracking_carrier ?? raw.tracking_carrier ?? raw.shipping_carrier ?? "To Be Assigned",
    ),
    trackingNumber: String(
      shipment?.tracking_number ?? raw.tracking_number ?? raw.trackingNo ?? "Pending",
    ),
    trackingUrl: String(shipment?.tracking_url ?? raw.tracking_url ?? ""),
  };
}

export function mapTimelineEvents(payload: unknown): OrderTimelineEvent[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root;
  const rows = Array.isArray(data?.timeline) ? data.timeline : [];

  return rows.map((row, index) => {
    const item = asRecord(row) ?? {};
    const actor = asRecord(item.actor);
    return {
      eventId: String(item.event_id ?? item.id ?? `event-${index + 1}`),
      event: String(item.event ?? "STATUS_UPDATED"),
      previousStatus:
        typeof item.previous_status === "string" ? item.previous_status : null,
      nextStatus: String(item.next_status ?? ""),
      reason: typeof item.reason === "string" ? item.reason : null,
      changedAt: String(item.changed_at ?? ""),
      actorName: typeof actor?.name === "string" ? actor.name : null,
      actorEmail: typeof actor?.email === "string" ? actor.email : null,
    };
  });
}

export function summarizeStatusCount(value: unknown): number {
  if (typeof value === "number") return value;
  const record = asRecord(value);
  if (!record) return 0;
  return toNumber(record.count ?? record.total ?? 0, 0);
}
