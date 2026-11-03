"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Filter,
  MessageSquare,
  Clock,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import {  InlineLoader, SectionLoader } from "@/app/components/Loader";
import { ModalPortal } from "@/app/components/ModalPortal";
import SupportThread from "@/app/components/support/SupportThread";
import SupportSearchBar from "@/app/components/support/SupportSearchBar";
import SupportMessageComposer from "@/app/components/support/SupportMessageComposer";
import { useSupportMessaging } from "@/app/hooks/useSupportMessaging";
import type { SupportConversation } from "@/app/lib/supportMessaging";
import { devApiJson } from "@/app/dev/lib/devApi";

type Status = "Open" | "In Progress" | "Resolved";
type Priority = "High" | "Medium" | "Low";

type ConcernRow = {
  id: string;
  user: string;
  email: string;
  subject: string;
  date: string;
  status: Status;
  priority: Priority;
  raw: SupportConversation;
};

function mapStatus(status: string): Status {
  const s = status.toLowerCase();
  if (s === "resolved" || s === "closed") return "Resolved";
  if (s === "open" || s === "waiting" || s === "queued") return "Open";
  return "In Progress";
}

function mapPriority(conv: SupportConversation): Priority {
  if ((conv.unreadCount ?? 0) > 0 || conv.escalationLevel === "super_admin") return "High";
  if (conv.escalationLevel === "dev") return "Medium";
  return "Low";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return "—";
  }
}

function statusBadge(status: Status): string {
  switch (status) {
    case "Open":
      return "bg-blue-100  text-blue-700";
    case "In Progress":
      return "bg-amber-100 text-amber-700";
    case "Resolved":
      return "bg-green-100 text-green-700";
  }
}

function statusIcon(status: Status) {
  switch (status) {
    case "Open":
      return <AlertCircle className="h-3.5 w-3.5" />;
    case "In Progress":
      return <Clock className="h-3.5 w-3.5" />;
    case "Resolved":
      return <CheckCircle2 className="h-3.5 w-3.5" />;
  }
}

function priorityBadge(p: Priority): string {
  switch (p) {
    case "High":
      return "bg-red-100    text-red-700";
    case "Medium":
      return "bg-amber-100  text-amber-700";
    case "Low":
      return "bg-gray-100   text-gray-600";
  }
}

const STATUS_FILTERS: { label: string; value: Status | "All" }[] = [
  { label: "All", value: "All" },
  { label: "Open", value: "Open" },
  { label: "In Progress", value: "In Progress" },
  { label: "Resolved", value: "Resolved" },
];

function toConcernRow(conv: SupportConversation): ConcernRow {
  return {
    id: `CRN-${conv.id}`,
    user: conv.client?.name ?? "Client",
    email: conv.client?.email ?? "—",
    subject: conv.lastMessagePreview || "Escalated support conversation",
    date: formatDate(conv.escalatedAt ?? conv.lastMessageAt ?? conv.createdAt),
    status: mapStatus(conv.status),
    priority: mapPriority(conv),
    raw: conv,
  };
}

export default function ConcernsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | "All">("All");
  const [concerns, setConcerns] = useState<ConcernRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return new URLSearchParams(window.location.search).get("conversationId")?.trim() || null;
    } catch {
      return null;
    }
  });
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveNote, setResolveNote] = useState("");
  const [resolving, setResolving] = useState(false);

  const {
    conversation,
    setConversation,
    messages,
    searchQuery,
    setSearchQuery,
    loading: threadLoading,
    error: threadError,
    refresh,
    resolveConversation,
    sendMessage,
    sending,
  } = useSupportMessaging({
    mode: "admin",
    conversationId: selectedId,
    enabled: !!selectedId,
    pollMs: 5000,
  });

  const loadConcerns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await devApiJson<SupportConversation[]>(
        "/api/superadmin/support/escalations",
        { method: "GET" },
      );
      if (!result.ok) throw new Error(result.error ?? "Failed to load concerns");
      const list = ((result.data ?? []) as SupportConversation[]).map(toConcernRow);
      setConcerns(list);
      const fromQuery =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("conversationId")?.trim() || null
          : null;
      if (fromQuery && list.some((c) => c.raw.id === fromQuery)) {
        setSelectedId(fromQuery);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load concerns");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConcerns();
    const id = window.setInterval(() => {
      void loadConcerns();
    }, 30000);
    return () => window.clearInterval(id);
  }, [loadConcerns]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      const id = new URLSearchParams(window.location.search).get("conversationId")?.trim() || null;
      if (id) setSelectedId(id);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const selected = concerns.find((c) => c.raw.id === selectedId);
    if (selected) setConversation(selected.raw);
  }, [concerns, selectedId, setConversation]);

  const filtered = useMemo(() => {
    return concerns.filter((c) => {
      const matchesStatus = statusFilter === "All" || c.status === statusFilter;
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        c.id.toLowerCase().includes(q) ||
        c.user.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.subject.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [concerns, search, statusFilter]);

  const counts = useMemo(
    () => ({
      all: concerns.length,
      open: concerns.filter((c) => c.status === "Open").length,
      inProgress: concerns.filter((c) => c.status === "In Progress").length,
      resolved: concerns.filter((c) => c.status === "Resolved").length,
    }),
    [concerns],
  );

  const active = conversation ?? concerns.find((c) => c.raw.id === selectedId)?.raw ?? null;
  const canResolve = active?.status !== "resolved" && active?.status !== "closed";

  const handleResolve = async () => {
    setResolving(true);
    try {
      await resolveConversation(resolveNote.trim() || undefined);
      setResolveOpen(false);
      setResolveNote("");
      await loadConcerns();
    } catch {
      // surfaced via hook
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total", value: counts.all, color: "text-[#2A4792]" },
          { label: "Open", value: counts.open, color: "text-blue-600" },
          { label: "In Progress", value: counts.inProgress, color: "text-amber-600" },
          { label: "Resolved", value: counts.resolved, color: "text-green-600" },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-xl px-4 py-3 border border-gray-100 shadow-sm"
          >
            <p className="text-xs text-gray-400 font-medium">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <span
            className="inline-block h-4 w-1 rounded-full shrink-0"
            style={{ background: "linear-gradient(180deg,#2A4792,#4785B8)" }}
          />
          <MessageSquare className="h-4 w-4 text-gray-500 shrink-0" />
          <h2 className="text-sm font-semibold text-gray-800 tracking-wide uppercase">
            All Concerns
          </h2>
        </div>

        <div className="px-5 py-3 border-b border-gray-50 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by ID, user or subject…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-4 text-sm text-gray-700 placeholder-gray-400 focus:border-[#2A4792]/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2A4792]/20"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <Filter className="h-4 w-4 text-gray-400 shrink-0" />
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatusFilter(f.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  statusFilter === f.value
                    ? "bg-[#2A4792] text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-xs text-gray-400 font-semibold uppercase tracking-wide border-b border-gray-100 bg-gray-50/50">
                <th className="px-5 py-3 text-left w-24">ID</th>
                <th className="px-5 py-3 text-left">User</th>
                <th className="px-5 py-3 text-left hidden md:table-cell">Subject</th>
                <th className="px-5 py-3 text-left w-28 hidden sm:table-cell">Date</th>
                <th className="px-5 py-3 text-left w-20">Priority</th>
                <th className="px-5 py-3 text-left w-28">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center">
                    <InlineLoader />
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-red-600">
                    {error}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-gray-400">
                    No concerns match your filters.
                  </td>
                </tr>
              ) : (
                filtered.map((c) => (
                  <tr
                    key={c.raw.id}
                    className="hover:bg-gray-50/60 transition-colors cursor-pointer"
                    onClick={() => setSelectedId(c.raw.id)}
                  >
                    <td className="px-5 py-3 font-mono text-xs text-gray-500">{c.id}</td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-800 truncate max-w-[140px]">{c.user}</p>
                      <p className="text-xs text-gray-400 truncate max-w-[140px]">{c.email}</p>
                    </td>
                    <td className="px-5 py-3 text-gray-500 hidden md:table-cell max-w-[220px] truncate">
                      {c.subject}
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap hidden sm:table-cell">
                      {c.date}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${priorityBadge(c.priority)}`}
                      >
                        {c.priority}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(c.status)}`}
                      >
                        {statusIcon(c.status)}
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400">
          Showing {filtered.length} of {concerns.length} concerns
        </div>
      </div>

      {selectedId ? (
        <ModalPortal isOpen={!!selectedId} onClose={() => setSelectedId(null)}>
          <div
            className="w-[min(100vw-1.5rem,56rem)] max-h-[90vh] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-gray-900">
                  {active?.client?.name ?? "Concern thread"}
                </h3>
                <p className="text-xs text-gray-500">{active?.client?.email}</p>
              </div>
              <div className="flex items-center gap-2">
                {canResolve ? (
                  <button
                    type="button"
                    onClick={() => setResolveOpen(true)}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    Resolve
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col px-4 py-3">
              <SupportSearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                onSubmit={() => {
                  void refresh();
                }}
              />
              {threadError ? (
                <p className="text-sm text-red-600 py-2">{threadError}</p>
              ) : null}
              <div className="flex-1 min-h-[20rem] overflow-y-auto">
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
              {canResolve ? (
                <SupportMessageComposer
                  disabled={!canResolve}
                  sending={sending}
                  onSend={async (body, attachments) => {
                    await sendMessage(body, attachments);
                    await refresh();
                    await loadConcerns();
                  }}
                />
              ) : null}
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {resolveOpen ? (
        <ModalPortal isOpen={resolveOpen} onClose={() => setResolveOpen(false)}>
          <div
            className="w-[min(100vw-2rem,24rem)] rounded-2xl border border-gray-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-sm font-semibold text-gray-900">Resolve concern</h4>
            <p className="mt-1 text-xs text-gray-500">
              Optionally add a short note for the client and staff.
            </p>
            <textarea
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              rows={4}
              className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2A4792]/20"
              placeholder="Resolution note (optional)"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResolveOpen(false)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={resolving}
                onClick={() => void handleResolve()}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {resolving ? "Resolving…" : "Confirm resolve"}
              </button>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </div>
  );
}
