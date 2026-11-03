"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Filter, Search, Users } from "lucide-react";
import type { SupportConversation } from "@/app/lib/supportMessaging";
import { ModalPortal } from "@/app/components/ModalPortal";
import { SectionLoader, InlineLoader } from "@/app/components/Loader";
import ClientAvatar from "./ClientAvatar";
import StaffUserSearch from "./StaffUserSearch";
import { csrfClient } from "@/lib/csrf-client";
import {
  ASSIGNMENT_OPTIONS,
  FILTER_OPTIONS,
  formatListTime,
  matchesAssignmentFilter,
  matchesFilter,
  matchesSearch,
  type AssignmentFilter,
  type ListFilter,
} from "./messagesUtils";

const POLL_INTERVAL_MS = 30000;

export default function ClientMessagesList() {
  const router = useRouter();
  const [conversations, setConversations] = useState<SupportConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ListFilter>("all");
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>("all");
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [assignmentMenuOpen, setAssignmentMenuOpen] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const assignmentMenuRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/staff/support/conversations", {
        credentials: "include",
        cache: "no-store",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          (payload as { error?: { message?: string } })?.error?.message
          ?? (payload as { error?: string })?.error
          ?? "Failed to load conversations";
        throw new Error(msg);
      }
      setConversations((payload.data ?? []) as SupportConversation[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load conversations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
    const id = window.setInterval(() => { void loadConversations(); }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [loadConversations]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) {
        setFilterMenuOpen(false);
      }
      if (assignmentMenuRef.current && !assignmentMenuRef.current.contains(event.target as Node)) {
        setAssignmentMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = useMemo(() => {
    return conversations.filter(
      (conv) =>
        matchesSearch(conv, search)
        && matchesAssignmentFilter(conv, assignmentFilter)
        && matchesFilter(conv, filter),
    );
  }, [conversations, search, filter, assignmentFilter]);

  const assignedCount = useMemo(() => {
    return conversations.filter((c) => !c.isPooled && c.staffId !== null).length;
  }, [conversations]);

  const assignConversation = useCallback(
    async (conversationId: string, event: React.MouseEvent) => {
      event.stopPropagation();
      setAssigningId(conversationId);
      setAssignError(null);
      try {
        const opts = await csrfClient.getFetchOptions("POST");
        const res = await fetch(
          `/api/staff/support/conversations/${conversationId}/assign`,
          opts,
        );
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg =
            (payload as { error?: { message?: string } })?.error?.message
            ?? (payload as { error?: string })?.error
            ?? "Failed to assign conversation";
          throw new Error(msg);
        }
        await loadConversations();
      } catch (e) {
        setAssignError(e instanceof Error ? e.message : "Failed to assign conversation");
        setTimeout(() => setAssignError(null), 5000);
      } finally {
        setAssigningId(null);
      }
    },
    [loadConversations],
  );

  const activeFilterLabel =
    FILTER_OPTIONS.find((opt) => opt.key === filter)?.label ?? "All";
  const activeAssignmentLabel =
    ASSIGNMENT_OPTIONS.find((opt) => opt.key === assignmentFilter)?.label ?? "All";
    
  const handleConversationOpened = useCallback(
    (conversationId: string) => {
      // Re-fetch the list so the newly started conversation appears
      void loadConversations();
    },
    [loadConversations],
  );

  if (loading && conversations.length === 0) {
    return <SectionLoader text="Loading conversations..." />;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-[#2A4792]">Client Messages</h2>
        <div className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-primary">
          Assigned
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#4785B8] px-1.5 text-[10px] font-bold text-white">
            {assignedCount}
          </span>
        </div>
      </div>

      {/* ── User / Company search ──────────────────────────── */}
      <div className="rounded-2xl border border-[#C8D4EB] bg-white px-4 py-3 shadow-sm">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Find user or company
        </p>
        <StaffUserSearch onConversationOpened={handleConversationOpened} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">

        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="w-full rounded-xl border border-gray-200 bg-white pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-light/30"
          />
        </div>

        <div className="relative shrink-0" ref={assignmentMenuRef}>
          <button
            type="button"
            onClick={() => setAssignmentMenuOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Users className="h-4 w-4" />
            {activeAssignmentLabel}
            <ChevronDown className="h-4 w-4" />
          </button>
          <ModalPortal isOpen={assignmentMenuOpen} onClose={() => setAssignmentMenuOpen(false)}>
            <div className="absolute right-0 mt-2 w-44 rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
              {ASSIGNMENT_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => {
                    setAssignmentFilter(opt.key);
                    setAssignmentMenuOpen(false);
                  }}
                  className={`block w-full px-4 py-2 text-left text-sm hover:bg-gray-50 ${
                    assignmentFilter === opt.key ? "font-semibold text-[#2A4792]" : ""
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </ModalPortal>
        </div>

        <div className="relative shrink-0" ref={filterMenuRef}>
          <button
            type="button"
            onClick={() => setFilterMenuOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Filter className="h-4 w-4" />
            {activeFilterLabel}
            <ChevronDown className="h-4 w-4" />
          </button>
          <ModalPortal isOpen={filterMenuOpen} onClose={() => setFilterMenuOpen(false)}>
            <div className="absolute right-0 mt-2 w-44 rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
              {FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => {
                    setFilter(opt.key);
                    setFilterMenuOpen(false);
                  }}
                  className={`block w-full px-4 py-2 text-left text-sm hover:bg-gray-50 ${
                    filter === opt.key ? "font-semibold text-[#2A4792]" : ""
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </ModalPortal>
        </div>
      </div>

      {(activeFilterLabel !== "All" || activeAssignmentLabel !== "All") && (
        <p className="text-xs text-gray-500">
          Showing: <span className="font-medium text-gray-700">{activeAssignmentLabel}</span>{" "}
          {activeFilterLabel !== "All" && (
            <>— <span className="font-medium text-gray-700">{activeFilterLabel}</span></>
          )}
        </p>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {assignError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {assignError}
        </div>
      )}

      {loading && conversations.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-gray-500">
          <InlineLoader />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-3xl border border-gray-100 bg-white px-6 py-16 text-center shadow-sm">
          <p className="text-sm text-gray-500">No client messages found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((conv) => {
            const unread = conv.unreadCount ?? 0;
            const name = conv.client?.name ?? "Client";
            const isAssigned = !conv.isPooled && conv.staffId !== null;
            const isAssigning = assigningId === conv.id;
            
            return (
              <div
                key={conv.id}
                className="w-full flex rounded-2xl border border-gray-100 bg-white px-4 py-4 shadow-sm transition-all hover:border-[#C8D4EB] hover:shadow-md justify-between"
              >
                <div
                  className="cursor-pointer"
                  onClick={() => router.push(`/staff/messages/${conv.id}`)}
                >
                  <div className="flex items-center gap-4">
                    <ClientAvatar
                      name={name}
                      profileUrl={conv.client?.profileUrl}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p
                          className={`truncate text-sm ${
                            unread > 0 ? "font-bold text-gray-900" : "font-semibold text-gray-800"
                          }`}
                        >
                          {name}

                        </p>
                        <span className="shrink-0 text-xs text-gray-400">
                          {formatListTime(conv.lastMessageAt)}
                        </span>
                      </div>


                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p
                          className={`truncate text-sm ${
                            unread > 0 ? "font-medium text-gray-700" : "text-gray-500"
                          }`}
                        >
                          {conv.lastMessagePreview ?? "No messages yet"}
                        </p>
                        {unread > 0 && (
                          <span className="shrink-0 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-light px-1.5 text-[10px] font-bold text-white">
                            {unread > 99 ? "99+" : unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                
                {!isAssigned && (
                  <button
                    type="button"
                    onClick={(e) => assignConversation(conv.id, e)}
                    disabled={isAssigning}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#4785B8] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3a6a94] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isAssigning ? (
                      <>
                        <InlineLoader />
                        Assigning...
                      </>
                    ) : (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        Assign to Me
                      </>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
