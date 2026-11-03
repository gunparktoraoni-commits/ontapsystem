"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Package, Truck, User, X } from "lucide-react";
import { InlineLoader } from "@/app/components/Loader";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { buildAuthHeaders } from "../StaffBizCardPanels";
import { STATUS_FILTER_CARDS, type StaffOrderColumn } from "./orderStatus";

const API = getFrontendApiBaseUrl();

type OrderDetail = {
  order_id: string;
  order_number: string;
  user: {
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
    contact: string | null;
  };
  status: string;
  status_note: string | null;
  totals: {
    subtotal: number;
    discount_amount: number;
    tax_amount: number;
    shipping_amount: number;
    total_amount: number;
    currency: string;
  };
  payment: {
    payment_method: string | null;
    payment_id: string | null;
    xendit_payment_id: string | null;
    xendit_status: string | null;
    xendit_invoice_url: string | null;
  };
  shipment: {
    tracking_number: string | null;
    tracking_carrier: string | null;
    tracking_url: string | null;
  };
  addresses: {
    shipping: Record<string, unknown> | null;
    billing: Record<string, unknown> | null;
  };
  notes: string | null;
  placed_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  refunded_at: string | null;
  items: Array<{
    item_id: string;
    item_type: string;
    item_name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
  }>;
};

type OrderTimeline = {
  order_id: string;
  order_number: string;
  current_status: string;
  timeline: Array<{
    event_id: string;
    event: string;
    previous_status: string | null;
    next_status: string;
    reason: string | null;
    changed_at: string;
    actor: {
      user_id: string;
      name: string;
      email: string;
    } | null;
  }>;
};

function formatMoney(value: number, currency = "PHP"): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatStatusLabel(status: string | null | undefined): string {
  if (!status) return "Unknown";
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatAddress(value: Record<string, unknown> | null): string[] {
  if (!value) return [];
  return Object.values(value)
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

function parseApiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const err = payload as Record<string, unknown>;
  if (typeof err.error === "string" && err.error.trim()) return err.error;
  if (err.error && typeof err.error === "object") {
    const nested = err.error as Record<string, unknown>;
    if (typeof nested.message === "string" && nested.message.trim()) return nested.message;
  }
  return fallback;
}

export default function ClientOrderDetailDrawer({
  open,
  orderId,
  onClose,
  onStatusChange,
  refreshKey = 0,
}: {
  open: boolean;
  orderId: string | null;
  onClose: () => void;
  onStatusChange: (orderId: string, status: StaffOrderColumn) => Promise<void>;
  refreshKey?: number;
}) {
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [timeline, setTimeline] = useState<OrderTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<StaffOrderColumn>("pending");
  const [savingStatus, setSavingStatus] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !orderId) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const headers = buildAuthHeaders();
        const [detailRes, timelineRes] = await Promise.all([
          fetch(`${API}/api/staff/portal/orders/${orderId}`, {
            credentials: "include",
            headers,
            cache: "no-store",
          }),
          fetch(`${API}/api/staff/portal/orders/${orderId}/timeline`, {
            credentials: "include",
            headers,
            cache: "no-store",
          }),
        ]);

        const detailPayload = await detailRes.json().catch(() => null);
        const timelinePayload = await timelineRes.json().catch(() => null);

        if (!detailRes.ok) {
          throw new Error(parseApiError(detailPayload, "Failed to load order details."));
        }
        if (!timelineRes.ok) {
          throw new Error(parseApiError(timelinePayload, "Failed to load order timeline."));
        }

        if (cancelled) return;
        const nextDetail = detailPayload?.data as OrderDetail;
        const nextTimeline = timelinePayload?.data as OrderTimeline;
        setDetail(nextDetail);
        setTimeline(nextTimeline);
        const matching = STATUS_FILTER_CARDS.find((card) => card.key === nextDetail.status);
        setSelectedStatus((matching?.key ?? "pending") as StaffOrderColumn);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load order details.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, orderId, refreshKey]);

  const shippingLines = useMemo(() => formatAddress(detail?.addresses.shipping ?? null), [detail]);
  const billingLines = useMemo(() => formatAddress(detail?.addresses.billing ?? null), [detail]);

  const handleStatusSave = async () => {
    if (!detail || savingStatus || selectedStatus === detail.status) return;
    setSavingStatus(true);
    setError(null);
    try {
      await onStatusChange(detail.order_id, selectedStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update order status.");
    } finally {
      setSavingStatus(false);
    }
  };

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex justify-end" role="presentation">
      <button
        type="button"
        aria-label="Close order details backdrop"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <aside
        className="relative z-10 flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-gray-200 bg-white shadow-2xl"
        aria-label="Order detail drawer"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-full flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[#4785B8]">Client Order</p>
              <h3 className="mt-1 text-lg font-bold text-gray-900">
                {detail ? `#${detail.order_number}` : "Order Details"}
              </h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
              aria-label="Close order details"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-8 pt-5">
            {loading ? (
              <div className="flex justify-center py-20">
                <InlineLoader />
              </div>
            ) : error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : !detail ? (
              <p className="py-16 text-center text-sm text-gray-500">Order details unavailable.</p>
            ) : (
              <div className="space-y-6">
                <section className="grid gap-3 rounded-2xl border border-gray-100 bg-[#fbfdff] p-4 sm:grid-cols-2">
                  <div className="rounded-xl bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                      <User className="h-4 w-4 text-[#4785B8]" />
                      Client
                    </div>
                    <p className="mt-3 font-semibold text-gray-900">
                      {[detail.user.first_name, detail.user.last_name].filter(Boolean).join(" ") || detail.user.email}
                    </p>
                    <p className="mt-1 text-sm text-gray-500">{detail.user.email}</p>
                    <p className="mt-1 text-sm text-gray-500">{detail.user.contact || "No contact number"}</p>
                  </div>
                  <div className="rounded-xl bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                      <Package className="h-4 w-4 text-[#4785B8]" />
                      Summary
                    </div>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Status</dt>
                        <dd className="font-semibold text-gray-900">{formatStatusLabel(detail.status)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Placed</dt>
                        <dd className="font-medium text-gray-900">
                          {new Date(detail.placed_at).toLocaleString()}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Total</dt>
                        <dd className="font-semibold text-[#2A4792]">
                          {formatMoney(detail.totals.total_amount, detail.totals.currency)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </section>

                <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-gray-900">Status Management</h4>
                      <p className="mt-1 text-xs text-gray-500">Update the order with full context from the drawer.</p>
                    </div>
                    <div className="flex gap-2">
                      <select
                        value={selectedStatus}
                        onChange={(event) => setSelectedStatus(event.target.value as StaffOrderColumn)}
                        className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-[#4785B8]/30"
                      >
                        {STATUS_FILTER_CARDS.map((card) => (
                          <option key={card.key} value={card.key}>
                            {card.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleStatusSave()}
                        disabled={savingStatus || selectedStatus === detail.status}
                        className="inline-flex h-10 items-center justify-center rounded-xl bg-[#2A4792] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#233f7d] disabled:opacity-50"
                      >
                        {savingStatus ? <InlineLoader className="text-white" /> : "Update"}
                      </button>
                    </div>
                  </div>
                  {detail.status_note && (
                    <p className="mt-3 rounded-xl bg-[#f6f8fc] px-3 py-2 text-sm text-gray-600">
                      Latest note: {detail.status_note}
                    </p>
                  )}
                </section>

                <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                  <h4 className="text-sm font-bold text-gray-900">Line Items</h4>
                  <div className="mt-3 space-y-3">
                    {detail.items.map((item) => (
                      <div
                        key={item.item_id}
                        className="flex flex-col gap-2 rounded-xl border border-gray-100 bg-[#fbfdff] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <p className="font-semibold text-gray-900">{item.item_name}</p>
                          <p className="mt-1 text-xs uppercase tracking-wide text-gray-500">{item.item_type}</p>
                        </div>
                        <div className="text-sm text-gray-600 sm:text-right">
                          <p>Qty: {item.quantity}</p>
                          <p className="font-semibold text-[#2A4792]">
                            {formatMoney(item.total_price, detail.totals.currency)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                    <h4 className="text-sm font-bold text-gray-900">Payment</h4>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Method</dt>
                        <dd className="font-medium text-gray-900">{detail.payment.payment_method || "—"}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Status</dt>
                        <dd className="font-medium text-gray-900">{detail.payment.xendit_status || "—"}</dd>
                      </div>
                    </dl>
                    {detail.payment.xendit_invoice_url && (
                      <a
                        href={detail.payment.xendit_invoice_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#4785B8] hover:underline"
                      >
                        View invoice
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>

                  <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
                      <Truck className="h-4 w-4 text-[#4785B8]" />
                      Shipping & Tracking
                    </div>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Carrier</dt>
                        <dd className="font-medium text-gray-900">{detail.shipment.tracking_carrier || "—"}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Tracking #</dt>
                        <dd className="font-medium text-gray-900">{detail.shipment.tracking_number || "—"}</dd>
                      </div>
                    </dl>
                    {detail.shipment.tracking_url && (
                      <a
                        href={detail.shipment.tracking_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#4785B8] hover:underline"
                      >
                        Open tracking
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </section>

                <section className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                    <h4 className="text-sm font-bold text-gray-900">Shipping Address</h4>
                    {shippingLines.length ? (
                      <div className="mt-3 space-y-1 text-sm text-gray-600">
                        {shippingLines.map((line, index) => (
                          <p key={`${line}-${index}`}>{line}</p>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-gray-400">No shipping address available.</p>
                    )}
                  </div>
                  <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                    <h4 className="text-sm font-bold text-gray-900">Billing Address</h4>
                    {billingLines.length ? (
                      <div className="mt-3 space-y-1 text-sm text-gray-600">
                        {billingLines.map((line, index) => (
                          <p key={`${line}-${index}`}>{line}</p>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-gray-400">No billing address available.</p>
                    )}
                  </div>
                </section>

                <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                  <h4 className="text-sm font-bold text-gray-900">Notes</h4>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-gray-600">
                    {detail.notes?.trim() || "No order notes available."}
                  </p>
                </section>

                <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                  <h4 className="text-sm font-bold text-gray-900">Status Timeline</h4>
                  <div className="mt-4 space-y-4">
                    {(timeline?.timeline ?? []).map((entry) => (
                      <div key={entry.event_id} className="relative pl-5">
                        <span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-[#4785B8]" />
                        <p className="text-sm font-semibold text-gray-900">
                          {entry.event === "ORDER_PLACED"
                            ? "Order placed"
                            : `Status updated to ${formatStatusLabel(entry.next_status)}`}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          {new Date(entry.changed_at).toLocaleString()}
                          {entry.actor ? ` • ${entry.actor.name || entry.actor.email}` : ""}
                        </p>
                        {entry.reason && (
                          <p className="mt-1 text-sm text-gray-600">{entry.reason}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
