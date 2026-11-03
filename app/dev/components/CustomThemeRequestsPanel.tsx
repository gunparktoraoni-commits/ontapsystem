"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Palette,
  RefreshCw,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { InlineLoader } from "@/app/components/Loader";
import { ModalPortal } from "@/app/components/ModalPortal";
import SupportThread from "@/app/components/support/SupportThread";
import SupportMessageComposer from "@/app/components/support/SupportMessageComposer";
import { useSupportMessaging } from "@/app/hooks/useSupportMessaging";
import { devApiJson } from "@/app/dev/lib/devApi";
import { showToast } from "@/app/components/Toast";

const STATUS_OPTIONS = [
  "pending",
  "reviewing",
  "quoted",
  "in_progress",
  "delivered",
  "closed",
  "cancelled",
] as const;

type ThemeRequestUser = {
  id: string;
  name: string;
  email: string;
  contact: string | null;
};

type CustomThemeRequest = {
  id: string;
  referenceNumber: string | null;
  projectName: string;
  industry: string | null;
  useCase: string | null;
  targetAudience: string | null;
  languages: string | null;
  primaryGoals: string[];
  themeStyles: string[];
  mood: string;
  colorWay: {
    primary: string | null;
    secondary: string | null;
    accent: string | null;
    background: string | null;
    notes: string | null;
  };
  typography: {
    headingStyle: string;
    bodyStyle: string;
    tone: string | null;
    preferredFonts: string | null;
    notes: string | null;
  };
  layoutPreferences: string[];
  mustHaveSections: string[];
  brandPersonality: string[];
  brandAssets: string | null;
  deliverableScope: string | null;
  inspirationUrls: string | null;
  referenceImageUrls: string[];
  avoidList: string | null;
  competitorNotes: string | null;
  moreDetails: string;
  contactPreference: string;
  status: string;
  staffNotes: string | null;
  conversationId: string | null;
  assignedTo: string | null;
  shopOrderId: string | null;
  paidAt: string | null;
  paymentAmount: number | null;
  feePhp?: number | null;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
  user: ThemeRequestUser | null;
  assignee: ThemeRequestUser | null;
};

type ListResponse = {
  requests: CustomThemeRequest[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  counts: {
    pending: number;
    reviewing: number;
    total: number;
  };
};

const THEME_STYLE_LABELS: Record<string, string> = {
  minimal: "Minimal / clean",
  luxury: "Luxury / premium",
  bold: "Bold / high-impact",
  editorial: "Editorial / magazine",
  corporate: "Corporate / professional",
  playful: "Playful / friendly",
  tech: "Tech / futuristic",
  organic: "Organic / natural",
  brutalist: "Brutalist / raw",
  glass: "Glassmorphism / soft blur",
  retro: "Retro / vintage",
  "soft-pastel": "Soft pastel / gentle",
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "—";
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "pending":
      return "bg-blue-100 text-blue-700";
    case "reviewing":
      return "bg-amber-100 text-amber-800";
    case "quoted":
      return "bg-violet-100 text-violet-700";
    case "in_progress":
      return "bg-sky-100 text-sky-800";
    case "delivered":
      return "bg-emerald-100 text-emerald-700";
    case "closed":
      return "bg-slate-100 text-slate-600";
    case "cancelled":
      return "bg-rose-100 text-rose-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

function ChipList({ items, empty = "—" }: { items: string[]; empty?: string }) {
  if (!items.length) {
    return <span className="text-sm text-slate-400">{empty}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-700"
        >
          {THEME_STYLE_LABELS[item] ?? item}
        </span>
      ))}
    </div>
  );
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  const isEmpty =
    value === null ||
    value === undefined ||
    value === "" ||
    (typeof value === "string" && !value.trim());
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <div className="text-sm text-slate-800 whitespace-pre-wrap break-words">
        {isEmpty ? <span className="text-slate-400">—</span> : value}
      </div>
    </div>
  );
}

function ColorSwatch({ label, value }: { label: string; value: string | null }) {
  const trimmed = value?.trim() || "";
  const isHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <span
        className="h-9 w-9 shrink-0 rounded-lg border border-black/10 shadow-inner"
        style={{ backgroundColor: isHex ? trimmed : "#e2e8f0" }}
        title={trimmed || "Not specified"}
      />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          {label}
        </p>
        <p className="truncate text-sm font-medium text-slate-800">
          {trimmed || "Open / propose"}
        </p>
      </div>
    </div>
  );
}

function CollapsibleSection({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 bg-slate-50 px-3 py-2.5 text-left"
      >
        <span className="text-sm font-semibold text-slate-800">
          {title}
          {typeof count === "number" ? (
            <span className="ml-2 text-xs font-medium text-slate-400">
              ({count})
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-slate-400 transition ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="space-y-3 border-t border-slate-100 px-3 py-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}

type DetailTab = "brief" | "assets" | "message" | "ops";

export default function CustomThemeRequestsPanel() {
  const [requests, setRequests] = useState<CustomThemeRequest[]>([]);
  const [selected, setSelected] = useState<CustomThemeRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });
  const [counts, setCounts] = useState({ pending: 0, reviewing: 0, total: 0 });
  const [staffNotes, setStaffNotes] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("brief");
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [notesDirty, setNotesDirty] = useState(false);

  const {
    messages,
    searchQuery,
    setSearchQuery,
    loading: threadLoading,
    error: threadError,
    refresh: refreshThread,
    sendMessage,
    sending,
  } = useSupportMessaging({
    mode: "admin",
    conversationId: detailOpen ? selected?.conversationId ?? null : null,
    enabled: detailOpen && Boolean(selected?.conversationId),
    pollMs: 5000,
  });

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (query.trim()) params.set("q", query.trim());
      params.set("page", String(page));
      params.set("pageSize", "20");
      const result = await devApiJson<ListResponse>(
        `/api/dev/custom-theme-requests?${params.toString()}`,
        { method: "GET" },
      );
      if (!result.ok || !result.data) {
        throw new Error(result.error || "Failed to load theme requests.");
      }
      setRequests(result.data.requests || []);
      setPagination(result.data.pagination);
      setCounts(result.data.counts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load requests.");
    } finally {
      setLoading(false);
    }
  }, [page, query, statusFilter]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const closeDetail = () => {
    setDetailOpen(false);
    setPreviewImage(null);
    setActiveTab("brief");
    setNotesDirty(false);
  };

  const openRequest = async (id: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const result = await devApiJson<CustomThemeRequest>(
        `/api/dev/custom-theme-requests/${id}`,
        { method: "GET" },
      );
      if (!result.ok || !result.data) {
        throw new Error(result.error || "Failed to open request.");
      }
      setSelected(result.data);
      setStaffNotes(result.data.staffNotes || "");
      setNotesDirty(false);
      setActiveTab("brief");
      setDetailOpen(true);
      void loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open request.");
    } finally {
      setDetailLoading(false);
    }
  };

  const updateRequest = async (payload: Record<string, unknown>) => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const result = await devApiJson<CustomThemeRequest>(
        `/api/dev/custom-theme-requests/${selected.id}`,
        { method: "PATCH", body: payload },
      );
      if (!result.ok || !result.data) {
        throw new Error(result.error || "Failed to update request.");
      }
      setSelected(result.data);
      setStaffNotes(result.data.staffNotes || "");
      setNotesDirty(false);
      showToast("Theme request updated.", "success");
      void loadList();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update request.";
      setError(message);
      showToast(message, "error");
    } finally {
      setSaving(false);
    }
  };

  const copyReference = async () => {
    if (!selected) return;
    const value = selected.referenceNumber || `CTR-${selected.id}`;
    try {
      await navigator.clipboard.writeText(value);
      showToast("Reference copied.", "success");
    } catch {
      showToast("Unable to copy reference.", "error");
    }
  };

  const kpiItems = useMemo(
    () => [
      {
        label: "Pending",
        value: counts.pending,
        icon: Clock,
        tone: "text-blue-700 bg-blue-50",
      },
      {
        label: "Reviewing",
        value: counts.reviewing,
        icon: Palette,
        tone: "text-amber-700 bg-amber-50",
      },
      {
        label: "Total",
        value: counts.total,
        icon: CheckCircle2,
        tone: "text-emerald-700 bg-emerald-50",
      },
    ],
    [counts],
  );

  const tabs: Array<{ id: DetailTab; label: string; badge?: number }> = [
    { id: "brief", label: "Brief" },
    {
      id: "assets",
      label: "Assets",
      badge: selected?.referenceImageUrls?.length || 0,
    },
    {
      id: "message",
      label: "Message",
      badge: selected?.conversationId ? messages.length : undefined,
    },
    { id: "ops", label: "Ops" },
  ];

  const hasExtraAudience =
    Boolean(selected?.industry) ||
    Boolean(selected?.useCase) ||
    Boolean(selected?.targetAudience) ||
    Boolean(selected?.languages) ||
    (selected?.primaryGoals?.length ?? 0) > 0;

  const hasExtraBrand =
    (selected?.brandPersonality?.length ?? 0) > 0 ||
    (selected?.layoutPreferences?.length ?? 0) > 0 ||
    (selected?.mustHaveSections?.length ?? 0) > 0 ||
    Boolean(selected?.brandAssets) ||
    Boolean(selected?.deliverableScope);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1f2d57]">Theme Requests</h1>
          <p className="mt-1 text-sm text-[#7c88ab]">
            Escalated custom theme briefs from E-Market. Review details and message
            the requester to clarify design direction.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => {
                setPage(1);
                setQuery(e.target.value);
              }}
              placeholder="Search project, user, reference…"
              className="w-full rounded-xl border border-[#d4dbec] bg-white py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => {
              setPage(1);
              setStatusFilter(e.target.value);
            }}
            className="rounded-xl border border-[#d4dbec] bg-white px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void loadList()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {kpiItems.map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border border-[#e4e9f5] bg-white px-4 py-3 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#7c88ab]">
                {item.label}
              </p>
              <span className={`rounded-lg p-1.5 ${item.tone}`}>
                <item.icon className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-2 text-2xl font-bold text-[#1f2d57]">{item.value}</p>
          </div>
        ))}
      </div>

      {error && !detailOpen ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-[#e4e9f5] bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
            <InlineLoader />
            Loading theme requests…
          </div>
        ) : requests.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">
            No theme requests yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#f7f9ff] text-[11px] uppercase tracking-wide text-[#7c88ab]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Reference</th>
                  <th className="px-4 py-3 font-semibold">Project</th>
                  <th className="px-4 py-3 font-semibold">Requester</th>
                  <th className="px-4 py-3 font-semibold">Styles</th>
                  <th className="px-4 py-3 font-semibold">References</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requests.map((request) => (
                  <tr
                    key={request.id}
                    className="cursor-pointer hover:bg-[#fafbff]"
                    onClick={() => void openRequest(request.id)}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {request.referenceNumber || `CTR-${request.id}`}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#1f2d57]">
                        {request.projectName}
                      </p>
                      <p className="text-xs text-slate-500">
                        {request.industry || "No industry"} · {request.mood}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">
                        {request.user?.name || "User"}
                      </p>
                      <p className="text-xs text-slate-500">
                        {request.user?.email || "—"}
                      </p>
                    </td>
                    <td className="px-4 py-3 max-w-[220px]">
                      <ChipList items={request.themeStyles.slice(0, 3)} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {(request.referenceImageUrls || []).length} image
                      {(request.referenceImageUrls || []).length === 1 ? "" : "s"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${statusBadgeClass(request.status)}`}
                      >
                        {request.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {formatDate(request.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pagination.totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
            <p className="text-slate-500">
              Page {pagination.page} of {pagination.totalPages} ·{" "}
              {pagination.total} total
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= pagination.totalPages}
                onClick={() =>
                  setPage((p) => Math.min(pagination.totalPages, p + 1))
                }
                className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {detailLoading ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20">
          <div className="rounded-xl bg-white px-4 py-3 text-sm shadow-lg">
            <InlineLoader /> Opening request…
          </div>
        </div>
      ) : null}

      {detailOpen && selected ? (
        <ModalPortal isOpen onClose={closeDetail}>
          <div
            className="relative flex w-[min(100vw-1rem,64rem)] max-h-[92vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Theme request detail"
          >
            {/* Header */}
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void copyReference()}
                    className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600 hover:bg-slate-200"
                    title="Copy reference"
                  >
                    {selected.referenceNumber || `CTR-${selected.id}`}
                    <Copy className="h-3 w-3" />
                  </button>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${statusBadgeClass(selected.status)}`}
                  >
                    {selected.status.replace(/_/g, " ")}
                  </span>
                </div>
                <h2 className="mt-1 truncate text-lg font-semibold text-slate-900">
                  {selected.projectName}
                </h2>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {selected.user
                    ? `${selected.user.name} · ${selected.user.email}`
                    : "Unknown requester"}
                  {" · "}
                  {formatDate(selected.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={closeDetail}
                aria-label="Close"
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 px-3 pt-2 sm:px-5">
              {tabs.map((tab) => {
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
                      active
                        ? "border-slate-900 text-slate-900"
                        : "border-transparent text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {tab.label}
                    {typeof tab.badge === "number" && tab.badge > 0 ? (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          active
                            ? "bg-slate-900 text-white"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {tab.badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
              {error ? (
                <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              {activeTab === "brief" ? (
                <div className="space-y-4">
                  <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <UserRound className="h-4 w-4 text-slate-500" />
                      <h3 className="text-sm font-semibold text-slate-900">
                        Overview
                      </h3>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <DetailField
                        label="Requester"
                        value={
                          selected.user
                            ? `${selected.user.name}\n${selected.user.email}${selected.user.contact ? `\n${selected.user.contact}` : ""}`
                            : "—"
                        }
                      />
                      <DetailField
                        label="Preferred contact"
                        value={selected.contactPreference.replace(/_/g, " ")}
                      />
                      <DetailField label="Mood" value={selected.mood} />
                      <DetailField
                        label="Theme styles"
                        value={<ChipList items={selected.themeStyles} />}
                      />
                    </div>
                  </section>

                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Creative brief
                    </h3>
                    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-slate-800">
                      {selected.moreDetails || "—"}
                    </div>
                  </section>

                  {(selected.colorWay.primary ||
                    selected.colorWay.secondary ||
                    selected.colorWay.accent ||
                    selected.colorWay.background ||
                    selected.colorWay.notes) && (
                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold text-slate-900">
                        Colors
                      </h3>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <ColorSwatch
                          label="Primary"
                          value={selected.colorWay.primary}
                        />
                        <ColorSwatch
                          label="Secondary"
                          value={selected.colorWay.secondary}
                        />
                        <ColorSwatch
                          label="Accent / CTA"
                          value={selected.colorWay.accent}
                        />
                        <ColorSwatch
                          label="Background"
                          value={selected.colorWay.background}
                        />
                      </div>
                      {selected.colorWay.notes ? (
                        <DetailField
                          label="Color notes"
                          value={selected.colorWay.notes}
                        />
                      ) : null}
                    </section>
                  )}

                  {(selected.typography.headingStyle ||
                    selected.typography.bodyStyle) && (
                    <CollapsibleSection title="Typography" defaultOpen={false}>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <DetailField
                          label="Heading"
                          value={selected.typography.headingStyle}
                        />
                        <DetailField
                          label="Body"
                          value={selected.typography.bodyStyle}
                        />
                        <DetailField
                          label="Tone"
                          value={selected.typography.tone}
                        />
                        <DetailField
                          label="Preferred fonts"
                          value={selected.typography.preferredFonts}
                        />
                      </div>
                      <DetailField
                        label="Notes"
                        value={selected.typography.notes}
                      />
                    </CollapsibleSection>
                  )}

                  {hasExtraAudience ? (
                    <CollapsibleSection title="Audience & goals">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <DetailField label="Industry" value={selected.industry} />
                        <DetailField label="Use case" value={selected.useCase} />
                        <DetailField
                          label="Target audience"
                          value={selected.targetAudience}
                        />
                        <DetailField
                          label="Languages"
                          value={selected.languages}
                        />
                      </div>
                      <DetailField
                        label="Primary goals"
                        value={<ChipList items={selected.primaryGoals} />}
                      />
                    </CollapsibleSection>
                  ) : null}

                  {hasExtraBrand ? (
                    <CollapsibleSection title="Layout & brand extras">
                      <DetailField
                        label="Brand personality"
                        value={<ChipList items={selected.brandPersonality} />}
                      />
                      <DetailField
                        label="Layout preferences"
                        value={<ChipList items={selected.layoutPreferences} />}
                      />
                      <DetailField
                        label="Must-have sections"
                        value={<ChipList items={selected.mustHaveSections} />}
                      />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <DetailField
                          label="Brand assets"
                          value={selected.brandAssets}
                        />
                        <DetailField
                          label="Deliverable scope"
                          value={selected.deliverableScope}
                        />
                      </div>
                    </CollapsibleSection>
                  ) : null}

                  {(selected.avoidList || selected.competitorNotes) && (
                    <CollapsibleSection title="Constraints">
                      <DetailField
                        label="Please avoid"
                        value={selected.avoidList}
                      />
                      <DetailField
                        label="Competitors / differentiation"
                        value={selected.competitorNotes}
                      />
                    </CollapsibleSection>
                  )}
                </div>
              ) : null}

              {activeTab === "assets" ? (
                <div className="space-y-4">
                  <section className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <ImageIcon className="h-4 w-4 text-slate-500" />
                        Reference images
                      </h3>
                      <span className="text-xs text-slate-400">
                        {(selected.referenceImageUrls || []).length} uploaded
                      </span>
                    </div>
                    {(selected.referenceImageUrls || []).length > 0 ? (
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {selected.referenceImageUrls.map((url) => (
                          <button
                            key={url}
                            type="button"
                            onClick={() => setPreviewImage(url)}
                            className="group relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-left"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt="Theme reference"
                              className="h-32 w-full object-cover transition group-hover:scale-[1.02]"
                            />
                            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-2 py-1.5 text-[10px] text-white opacity-0 transition group-hover:opacity-100">
                              Click to preview
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
                        No reference images attached.
                      </div>
                    )}
                  </section>

                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Inspiration links
                    </h3>
                    {selected.inspirationUrls?.trim() ? (
                      <div className="space-y-2">
                        {selected.inspirationUrls
                          .split(/[\n,]+/)
                          .map((part) => part.trim())
                          .filter(Boolean)
                          .map((link) => {
                            const href = /^https?:\/\//i.test(link)
                              ? link
                              : `https://${link}`;
                            return (
                              <a
                                key={link}
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                              >
                                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                <span className="truncate">{link}</span>
                              </a>
                            );
                          })}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400">No inspiration links.</p>
                    )}
                  </section>
                </div>
              ) : null}

              {activeTab === "message" ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <MessageSquare className="mt-0.5 h-4 w-4 text-slate-500" />
                    <p className="text-xs text-slate-600">
                      Chat with the requester about design direction. Messages go
                      through the escalated support conversation.
                    </p>
                  </div>
                  {selected.conversationId ? (
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                      {threadError ? (
                        <p className="border-b border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                          {threadError}
                        </p>
                      ) : null}
                      <div className="max-h-[min(48vh,28rem)] min-h-[16rem] overflow-y-auto px-3 py-2">
                        {threadLoading && messages.length === 0 ? (
                          <div className="flex justify-center py-10">
                            <InlineLoader />
                          </div>
                        ) : (
                          <SupportThread
                            messages={messages}
                            currentUserRole="dev"
                            highlightQuery={searchQuery}
                          />
                        )}
                      </div>
                      <div className="space-y-2 border-t border-slate-100 px-3 py-2">
                        <input
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search messages…"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                        />
                        <SupportMessageComposer
                          sending={sending}
                          onSend={async (body, attachments) => {
                            await sendMessage(body, attachments);
                            await refreshThread();
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-800">
                      No support conversation is linked to this request yet.
                    </div>
                  )}
                </div>
              ) : null}

              {activeTab === "ops" ? (
                <div className="space-y-4">
                  <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                      Payment
                    </p>
                    <p className="mt-1 text-sm font-semibold text-emerald-900">
                      {selected.paidAt
                        ? `Paid ₱${Number(selected.paymentAmount ?? selected.feePhp ?? 200).toFixed(0)}`
                        : "Payment confirmed (legacy request)"}
                    </p>
                    <p className="mt-0.5 text-xs text-emerald-800/80">
                      {selected.paidAt
                        ? `Paid at ${formatDate(selected.paidAt)}`
                        : "Visible in queue because it is past awaiting payment."}
                      {selected.shopOrderId
                        ? ` · Order #${selected.shopOrderId}`
                        : ""}
                    </p>
                  </section>

                  <section className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Status
                      </label>
                      <select
                        value={selected.status}
                        disabled={saving}
                        onChange={(e) =>
                          void updateRequest({ status: e.target.value })
                        }
                        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
                      >
                        {STATUS_OPTIONS.map((status) => (
                          <option key={status} value={status}>
                            {status.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void updateRequest({ assignToSelf: true })}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {selected.assignee ? "Reassign to me" : "Assign to me"}
                      </button>
                    </div>
                  </section>

                  <DetailField
                    label="Assignee"
                    value={
                      selected.assignee
                        ? `${selected.assignee.name} (${selected.assignee.email})`
                        : "Unassigned"
                    }
                  />

                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Staff notes
                      </label>
                      {notesDirty ? (
                        <span className="text-[11px] font-medium text-amber-600">
                          Unsaved changes
                        </span>
                      ) : null}
                    </div>
                    <textarea
                      value={staffNotes}
                      onChange={(e) => {
                        setStaffNotes(e.target.value);
                        setNotesDirty(true);
                      }}
                      rows={5}
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
                      placeholder="Internal notes for design handoff, quote, timeline…"
                    />
                    <button
                      type="button"
                      disabled={saving || !notesDirty}
                      onClick={() =>
                        void updateRequest({ staffNotes: staffNotes })
                      }
                      className="mt-2 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      Save notes
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Footer */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:px-5">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("message")}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <MessageSquare className="h-4 w-4" />
                  Message
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("ops")}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Update status
                </button>
              </div>
              <button
                type="button"
                onClick={closeDetail}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Done
              </button>
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {previewImage && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
              onClick={() => setPreviewImage(null)}
              role="presentation"
            >
              <div
                className="relative max-h-[90vh] max-w-[min(96vw,56rem)] overflow-hidden rounded-xl bg-black"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label="Image preview"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewImage}
                  alt="Reference preview"
                  className="max-h-[90vh] w-full object-contain"
                />
                <div className="absolute right-2 top-2 flex gap-2">
                  <a
                    href={previewImage}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
                    aria-label="Open original"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  <button
                    type="button"
                    onClick={() => setPreviewImage(null)}
                    className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
                    aria-label="Close preview"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
