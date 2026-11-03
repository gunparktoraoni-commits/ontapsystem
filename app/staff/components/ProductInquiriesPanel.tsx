"use client";

import { useCallback, useEffect, useState } from "react";
import { getFrontendApiBaseUrl } from "../../components/apiBase";

const API = getFrontendApiBaseUrl();

async function ensureCsrfToken(): Promise<string | null> {
  try {
    const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
    const res = await fetch(`${API}/api/csrf-token`, { credentials: "include", cache: "no-store" });
    const json = await res.json().catch(() => null);
    return typeof json?.token === "string" ? json.token : null;
  } catch {
    return null;
  }
}

type InquiryAttachment = {
  url: string;
  name: string;
  mimeType: string;
  size: number;
};

type InquiryItem = {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  variant: string | null;
  subscriptionTier: string | null;
  logoType: string | null;
  note: string | null;
  imageUrl: string | null;
};

type ProductInquiry = {
  id: string;
  referenceNumber: string | null;
  title: string;
  name: string;
  email: string;
  contact: string;
  note: string | null;
  items: InquiryItem[];
  attachments: InquiryAttachment[];
  status: string;
  staffNotes: string | null;
  createdAt: string;
  readAt: string | null;
  contactedAt: string | null;
};

const STATUS_OPTIONS = ["pending", "read", "contacted", "quoted", "closed", "cancelled"] as const;

export default function ProductInquiriesPanel({ apiBase = "/api/staff/product-inquiries" }: { apiBase?: string }) {
  const [inquiries, setInquiries] = useState<ProductInquiry[]>([]);
  const [selected, setSelected] = useState<ProductInquiry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [query, setQuery] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [staffNotes, setStaffNotes] = useState("");

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`${API}${apiBase}?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to load inquiries");
      }
      setInquiries(json.data.inquiries || []);
      setPendingCount(json.data.pendingCount || 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load inquiries");
    } finally {
      setLoading(false);
    }
  }, [apiBase, query, statusFilter]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const openInquiry = async (id: string) => {
    try {
      const res = await fetch(`${API}${apiBase}/${id}`, {
        credentials: "include",
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to open inquiry");
      }
      setSelected(json.data);
      setStaffNotes(json.data.staffNotes || "");
      void loadList();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to open inquiry");
    }
  };

  const updateInquiry = async (payload: Record<string, unknown>) => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const csrf = await ensureCsrfToken();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (csrf) headers["X-CSRF-Token"] = csrf;
      const res = await fetch(`${API}${apiBase}/${selected.id}`, {
        method: "PATCH",
        credentials: "include",
        headers,
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to update inquiry");
      }
      setSelected(json.data);
      setStaffNotes(json.data.staffNotes || "");
      void loadList();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update inquiry");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Product Inquiries</h1>
            <p className="text-sm text-gray-500 mt-1">
              Quote requests from upon-inquiry products. {pendingCount} pending.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email, reference..."
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white min-w-[220px]"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void loadList()}
              className="px-4 py-2 rounded-lg bg-[#4785B8] text-white text-sm font-medium"
            >
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <div className="grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {loading ? (
              <p className="p-6 text-sm text-gray-500">Loading inquiries…</p>
            ) : inquiries.length === 0 ? (
              <p className="p-6 text-sm text-gray-500">No product inquiries yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto">
                {inquiries.map((inquiry) => (
                  <li key={inquiry.id}>
                    <button
                      type="button"
                      onClick={() => void openInquiry(inquiry.id)}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition ${
                        selected?.id === inquiry.id ? "bg-sky-50" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 truncate">{inquiry.title}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {inquiry.referenceNumber || `#${inquiry.id}`} · {inquiry.name}
                          </p>
                        </div>
                        <span className="shrink-0 text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                          {inquiry.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        {new Date(inquiry.createdAt).toLocaleString()}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-6">
            {!selected ? (
              <div className="h-full min-h-[320px] flex items-center justify-center text-sm text-gray-500">
                Select an inquiry to review details, attachments, and contact the client.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">
                      {selected.referenceNumber || `Inquiry #${selected.id}`}
                    </p>
                    <h2 className="text-xl font-bold text-gray-900 mt-1">{selected.title}</h2>
                  </div>
                  <select
                    value={selected.status}
                    disabled={saving}
                    onChange={(e) => void updateInquiry({ status: e.target.value, assignToSelf: true })}
                    className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid sm:grid-cols-3 gap-3 text-sm">
                  <div className="rounded-xl bg-gray-50 p-3">
                    <p className="text-xs text-gray-400">Client</p>
                    <p className="font-medium text-gray-900">{selected.name}</p>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-3">
                    <p className="text-xs text-gray-400">Email</p>
                    <a href={`mailto:${selected.email}`} className="font-medium text-[#4785B8] break-all">
                      {selected.email}
                    </a>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-3">
                    <p className="text-xs text-gray-400">Contact</p>
                    <a href={`tel:${selected.contact}`} className="font-medium text-[#4785B8]">
                      {selected.contact}
                    </a>
                  </div>
                </div>

                {selected.note && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 mb-1">Client note</h3>
                    <p className="text-sm text-gray-600 whitespace-pre-wrap rounded-xl border border-gray-100 p-3 bg-gray-50">
                      {selected.note}
                    </p>
                  </div>
                )}

                <div>
                  <h3 className="text-sm font-semibold text-gray-800 mb-2">Order details</h3>
                  <div className="space-y-2">
                    {selected.items.map((item, idx) => (
                      <div
                        key={`${item.productId}-${idx}`}
                        className="flex gap-3 rounded-xl border border-gray-100 p-3"
                      >
                        {item.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.imageUrl}
                            alt={item.productName}
                            className="w-14 h-14 rounded-lg object-cover bg-gray-100"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded-lg bg-gray-100" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900">{item.productName}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Qty {item.quantity}
                            {item.variant ? ` · ${item.variant}` : ""}
                            {item.subscriptionTier ? ` · ${item.subscriptionTier}` : ""}
                            {item.logoType ? ` · logo: ${item.logoType}` : ""}
                          </p>
                          {item.note && (
                            <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{item.note}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {selected.attachments.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 mb-2">Attachments</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {selected.attachments.map((file) => (
                        <a
                          key={file.url}
                          href={file.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-xl border border-gray-100 overflow-hidden hover:border-[#4785B8] transition"
                        >
                          {file.mimeType.startsWith("image/") ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={file.url} alt={file.name} className="h-28 w-full object-cover" />
                          ) : (
                            <div className="h-28 flex items-center justify-center bg-gray-50 text-xs text-gray-500 p-2 text-center">
                              {file.name}
                            </div>
                          )}
                          <p className="text-[11px] text-gray-500 truncate px-2 py-1">{file.name}</p>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <h3 className="text-sm font-semibold text-gray-800 mb-2">Internal staff notes</h3>
                  <textarea
                    value={staffNotes}
                    onChange={(e) => setStaffNotes(e.target.value)}
                    rows={4}
                    className="w-full rounded-xl border border-gray-200 p-3 text-sm"
                    placeholder="Call notes, quote amount, follow-up reminders…"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        void updateInquiry({
                          staffNotes,
                          assignToSelf: true,
                          status: selected.status === "pending" ? "read" : selected.status,
                        })
                      }
                      className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm disabled:opacity-50"
                    >
                      Save notes
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void updateInquiry({ status: "contacted", assignToSelf: true })}
                      className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-50"
                    >
                      Mark contacted
                    </button>
                    <a
                      href={`mailto:${selected.email}?subject=${encodeURIComponent(
                        `Re: ${selected.referenceNumber || selected.title}`,
                      )}`}
                      className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-700"
                    >
                      Email client
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
