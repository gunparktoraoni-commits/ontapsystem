"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Package, Truck, User, X } from "lucide-react";
import { InlineLoader } from "@/app/components/Loader";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import {
  formatAddressValue,
  formatPeso,
  mapOrderRecord,
  mapTimelineEvents,
  type OrderRecord,
  type OrderTimelineEvent,
} from "./orderMappers";
import {
  STATUS_SUMMARY_CARDS,
  labelToApiStatus,
  normalizeOrderStatusLabel,
  normalizeOrderToColumn,
  type OrderStatusLabel,
} from "./orderStatus";

const API = getFrontendApiBaseUrl();

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

function formatTimelineLabel(event: OrderTimelineEvent): string {
  if (event.event === "ORDER_PLACED") return "Order placed";
  const next = normalizeOrderStatusLabel(event.nextStatus);
  const previous = event.previousStatus
    ? normalizeOrderStatusLabel(event.previousStatus)
    : null;
  if (previous) return `Status: ${previous} → ${next}`;
  return `Status updated to ${next}`;
}

export default function OrderDetailDrawer({
  open,
  orderId,
  fallbackOrder,
  onClose,
  onStatusUpdated,
  refreshKey = 0,
}: {
  open: boolean;
  orderId: string | null;
  fallbackOrder?: OrderRecord | null;
  onClose: () => void;
  onStatusUpdated: () => void;
  refreshKey?: number;
}) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderRecord | null>(null);
  const [timeline, setTimeline] = useState<OrderTimelineEvent[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<OrderStatusLabel>("Pending");
  const [reason, setReason] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingCarrier, setTrackingCarrier] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const fallbackOrderRef = useRef(fallbackOrder);
  fallbackOrderRef.current = fallbackOrder;

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
        const [detailRes, timelineRes] = await Promise.all([
          fetch(`${API}/api/superadmin/orders/${encodeURIComponent(orderId)}`, {
            credentials: "include",
            cache: "no-store",
          }),
          fetch(`${API}/api/superadmin/orders/${encodeURIComponent(orderId)}/timeline`, {
            credentials: "include",
            cache: "no-store",
          }),
        ]);

        const detailPayload = await detailRes.json().catch(() => null);
        const timelinePayload = await timelineRes.json().catch(() => null);

        if (!detailRes.ok) {
          throw new Error(parseApiError(detailPayload, "Failed to load order details."));
        }

        if (cancelled) return;

        const mapped = mapOrderRecord(
          ((detailPayload?.data ?? detailPayload) ?? {}) as Record<string, unknown>,
          0,
        );
        setDetail(mapped);
        setSelectedStatus(mapped.status);
        setReason(mapped.notes || "");
        setTrackingNumber(mapped.trackingNumber === "Pending" ? "" : mapped.trackingNumber);
        setTrackingCarrier(
          mapped.shippingCarrier === "To Be Assigned" ? "" : mapped.shippingCarrier,
        );
        setTrackingUrl(mapped.trackingUrl || "");

        if (timelineRes.ok) {
          setTimeline(mapTimelineEvents(timelinePayload));
        } else {
          setTimeline([]);
        }
      } catch (err) {
        if (!cancelled) {
          const fallback = fallbackOrderRef.current;
          if (fallback) {
            setDetail(fallback);
            setSelectedStatus(fallback.status);
            setReason(fallback.notes || "");
            setTrackingNumber(
              fallback.trackingNumber === "Pending" ? "" : fallback.trackingNumber,
            );
            setTrackingCarrier(
              fallback.shippingCarrier === "To Be Assigned"
                ? ""
                : fallback.shippingCarrier,
            );
            setTrackingUrl(fallback.trackingUrl || "");
          }
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

  const shippingLines = useMemo(() => {
    if (!detail?.customerAddress) return [];
    return detail.customerAddress
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }, [detail]);

  const handleStatusSave = async () => {
    if (!detail || saving) return;
    const apiStatus = labelToApiStatus(selectedStatus);
    const currentApi = normalizeOrderToColumn(detail.status);
    if (apiStatus === currentApi && !reason.trim() && !trackingNumber.trim()) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `${API}/api/superadmin/orders/${encodeURIComponent(detail.id)}/status`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: apiStatus,
            reason: reason.trim() || undefined,
            tracking_number: trackingNumber.trim() || undefined,
            tracking_carrier: trackingCarrier.trim() || undefined,
            tracking_url: trackingUrl.trim() || undefined,
          }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(parseApiError(payload, "Failed to update order status."));
      }
      onStatusUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update order status.");
    } finally {
      setSaving(false);
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
              <p className="text-xs font-semibold uppercase tracking-wide text-[#4785B8]">
                Super Admin Order
              </p>
              <h3 className="mt-1 text-lg font-bold text-gray-900">
                {detail ? `#${detail.orderId}` : "Order Details"}
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
            ) : !detail ? (
              <p className="py-16 text-center text-sm text-gray-500">Order details unavailable.</p>
            ) : (
              <div className="space-y-6">
                {error ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {error}
                  </div>
                ) : null}

                <section className="grid gap-3 rounded-2xl border border-gray-100 bg-[#fbfdff] p-4 sm:grid-cols-2">
                  <div className="rounded-xl bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                      <User className="h-4 w-4 text-[#4785B8]" />
                      Customer
                    </div>
                    <p className="mt-3 font-semibold text-gray-900">{detail.customerName}</p>
                    <p className="mt-1 text-sm text-gray-500">{detail.customerEmail || "No email"}</p>
                    <p className="mt-1 text-sm text-gray-500">
                      {detail.customerPhone || "No contact number"}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                      <Package className="h-4 w-4 text-[#4785B8]" />
                      Summary
                    </div>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Status</dt>
                        <dd className="font-semibold text-gray-900">{detail.status}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Placed</dt>
                        <dd className="font-medium text-gray-900">{detail.dateIso}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Total</dt>
                        <dd className="font-semibold text-[#2A4792]">{formatPeso(detail.amount)}</dd>
                      </div>
                    </dl>
                  </div>
                </section>

                <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                  <h4 className="text-sm font-bold text-gray-900">Status & Tracking</h4>
                  <p className="mt-1 text-xs text-gray-500">
                    Only status, reason, and tracking fields are persisted.
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1 sm:col-span-2">
                      <span className="text-xs font-semibold text-gray-500">Status</span>
                      <select
                        value={selectedStatus}
                        onChange={(event) =>
                          setSelectedStatus(event.target.value as OrderStatusLabel)
                        }
                        className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-[#4785B8]/30"
                      >
                        {STATUS_SUMMARY_CARDS.map((card) => (
                          <option key={card.key} value={card.uiStatus}>
                            {card.uiStatus}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-gray-500">Carrier</span>
                      <input
                        type="text"
                        value={trackingCarrier}
                        onChange={(event) => setTrackingCarrier(event.target.value)}
                        className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#4785B8]/30"
                        placeholder="LBC, J&T, etc."
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-gray-500">Tracking number</span>
                      <input
                        type="text"
                        value={trackingNumber}
                        onChange={(event) => setTrackingNumber(event.target.value)}
                        className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#4785B8]/30"
                      />
                    </label>
                    <label className="space-y-1 sm:col-span-2">
                      <span className="text-xs font-semibold text-gray-500">Tracking URL</span>
                      <input
                        type="url"
                        value={trackingUrl}
                        onChange={(event) => setTrackingUrl(event.target.value)}
                        className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#4785B8]/30"
                        placeholder="https://"
                      />
                    </label>
                    <label className="space-y-1 sm:col-span-2">
                      <span className="text-xs font-semibold text-gray-500">Reason / note</span>
                      <textarea
                        rows={3}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4785B8]/30"
                      />
                    </label>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleStatusSave()}
                      disabled={saving}
                      className="inline-flex h-10 items-center justify-center rounded-xl bg-[#2A4792] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#233f7d] disabled:opacity-50"
                    >
                      {saving ? <InlineLoader className="text-white" /> : "Update order"}
                    </button>
                  </div>
                </section>

                <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                  <h4 className="text-sm font-bold text-gray-900">Line Items</h4>
                  <div className="mt-3 space-y-3">
                    {detail.lineItems.length === 0 ? (
                      <p className="text-sm text-gray-500">{detail.itemsSummary}</p>
                    ) : (
                      detail.lineItems.map((item) => (
                        <div
                          key={item.id}
                          className="flex flex-col gap-2 rounded-xl border border-gray-100 bg-[#fbfdff] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div>
                            <p className="font-semibold text-gray-900">{item.name}</p>
                            <p className="mt-1 text-xs text-gray-500">Qty: {item.quantity}</p>
                          </div>
                          <p className="text-sm font-semibold text-[#2A4792]">
                            {formatPeso(item.quantity * item.unitPrice)}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <section className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                    <h4 className="text-sm font-bold text-gray-900">Payment</h4>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Method</dt>
                        <dd className="font-medium text-gray-900">{detail.paymentMethod}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Transaction</dt>
                        <dd className="font-medium text-gray-900 break-all">
                          {detail.transactionId || "—"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
                      <Truck className="h-4 w-4 text-[#4785B8]" />
                      Shipping
                    </div>
                    <div className="mt-3 space-y-1 text-sm text-gray-600">
                      {shippingLines.length > 0 ? (
                        shippingLines.map((line) => <p key={line}>{line}</p>)
                      ) : (
                        <p>{formatAddressValue(detail.customerAddress) || "No shipping address"}</p>
                      )}
                      {detail.trackingUrl ? (
                        <a
                          href={detail.trackingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-[#4785B8] hover:underline"
                        >
                          Track shipment <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                  <h4 className="text-sm font-bold text-gray-900">Activity</h4>
                  <ul className="mt-3 space-y-3">
                    {timeline.length === 0 ? (
                      <li className="text-sm text-gray-500">No activity recorded yet.</li>
                    ) : (
                      timeline.map((entry) => (
                        <li key={entry.eventId} className="flex items-start gap-3">
                          <span className="mt-1.5 inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                          <div>
                            <p className="text-sm font-semibold text-gray-900">
                              {formatTimelineLabel(entry)}
                            </p>
                            <p className="text-xs text-gray-500">
                              {entry.changedAt
                                ? new Date(entry.changedAt).toLocaleString()
                                : "—"}
                              {entry.actorName ? ` · ${entry.actorName}` : ""}
                            </p>
                            {entry.reason ? (
                              <p className="mt-1 text-xs text-gray-600">{entry.reason}</p>
                            ) : null}
                          </div>
                        </li>
                      ))
                    )}
                  </ul>
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
