"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, MessageSquare } from "lucide-react";
import { InlineLoader } from "@/app/components/Loader";
import SupportThread from "@/app/components/support/SupportThread";
import SupportSearchBar from "@/app/components/support/SupportSearchBar";
import SupportMessageComposer from "@/app/components/support/SupportMessageComposer";
import { ModalPortal } from "@/app/components/ModalPortal";
import { useSupportMessaging } from "@/app/hooks/useSupportMessaging";
import type { SupportConversation } from "@/app/lib/supportMessaging";

function formatListTime(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function escalationLabel(level: string): string {
  if (level === "super_admin") return "Super Admin";
  if (level === "dev") return "Dev";
  return level;
}

export default function SupportEscalationsPage() {
  const [conversations, setConversations] = useState<SupportConversation[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
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
  const [currentUserRole, setCurrentUserRole] = useState<"dev" | "super_admin">("super_admin");

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  const {
    conversation,
    setConversation,
    messages,
    searchQuery,
    setSearchQuery,
    loading,
    error,
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

  const activeConversation = conversation ?? selected;
  const canResolve = activeConversation?.status !== "resolved" && activeConversation?.status !== "closed";

  const loadEscalations = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetch("/api/superadmin/support/escalations", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load escalations");
      const payload = await res.json();
      const list = (payload.data ?? []) as SupportConversation[];
      setConversations(list);
      const fromQuery =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("conversationId")?.trim() || null
          : null;
      setSelectedId((prev) => {
        const preferred = fromQuery || prev;
        if (preferred && list.some((c) => c.id === preferred)) return preferred;
        return list[0]?.id ?? null;
      });
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Failed to load escalations");
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEscalations();
    const id = window.setInterval(() => { void loadEscalations(); }, 30000);
    return () => window.clearInterval(id);
  }, [loadEscalations]);

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
    let cancelled = false;
    const loadSessionRole = async () => {
      try {
        const res = await fetch("/api/auth/session", { credentials: "include", cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const role = String(data.user?.role ?? "").toLowerCase();
        if (role === "dev" || role === "super_admin") {
          setCurrentUserRole(role);
        }
      } catch {
        // keep default role
      }
    };
    void loadSessionRole();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (selected) setConversation(selected);
  }, [selected, setConversation]);

  const handleResolve = async () => {
    setResolving(true);
    try {
      await resolveConversation(resolveNote.trim() || undefined);
      setResolveOpen(false);
      setResolveNote("");
      await loadEscalations();
    } catch {
      // error via hook
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Support escalations</h2>
        <p className="text-sm text-gray-500">
          Respond to escalated client conversations and mark issues as fixed when resolved.
        </p>
      </div>

      <div className="flex min-h-[28rem] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm md:h-[calc(100vh-12rem)] md:min-h-[32rem] md:flex-row">
        <aside className="flex w-full flex-col border-b border-gray-200 md:max-w-xs md:shrink-0 md:border-b-0 md:border-r">
          <div className="px-4 py-3 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">Escalated threads</h3>
          </div>
          <div className="max-h-[40vh] flex-1 overflow-y-auto md:max-h-none">
            {listLoading && conversations.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-gray-500">
                <InlineLoader />
              </div>
            ) : listError ? (
              <p className="px-4 py-6 text-sm text-red-600">{listError}</p>
            ) : conversations.length === 0 ? (
              <p className="px-4 py-8 text-sm text-gray-500 text-center">No escalated conversations.</p>
            ) : (
              conversations.map((conv) => {
                const isActive = conv.id === selectedId;
                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => setSelectedId(conv.id)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors ${
                      isActive ? "bg-blue-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {conv.client?.name ?? "Client"}
                        </p>
                        <span className="inline-flex items-center gap-1 mt-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                          <AlertTriangle className="h-3 w-3" />
                          {escalationLabel(conv.escalationLevel)}
                        </span>
                        <p className="text-xs text-gray-500 truncate mt-1">
                          {conv.lastMessagePreview ?? "—"}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-[10px] text-gray-400">
                          {formatListTime(conv.escalatedAt ?? conv.lastMessageAt)}
                        </span>
                        {(conv.unreadCount ?? 0) > 0 && (
                          <span className="h-2 w-2 rounded-full bg-red-500" />
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="flex min-h-[24rem] w-full min-w-0 flex-1 flex-col md:min-h-0">
          {!selectedId ? (
            <div className="flex flex-1 flex-col items-center justify-center text-gray-500 gap-2">
              <MessageSquare className="h-10 w-10 text-gray-300" />
              <p className="text-sm">Select an escalation to review</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">
                    {activeConversation?.client?.name ?? "Client"}
                  </h3>
                  <p className="text-xs text-gray-500">{activeConversation?.client?.email}</p>
                </div>
                {canResolve && (
                  <button
                    type="button"
                    onClick={() => setResolveOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Mark as Fixed
                  </button>
                )}
              </div>
              <SupportSearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                onSubmit={() => { void refresh(); }}
              />
              {(error || listError) && (
                <div className="mx-3 mt-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">
                  {error ?? listError}
                </div>
              )}
              {loading && messages.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
                  <InlineLoader />
                  <span className="ml-2">Loading messages...</span>
                </div>
              ) : (
                <>
                  <SupportThread
                    messages={messages}
                    currentUserRole={currentUserRole}
                    highlightQuery={searchQuery}
                  />
                  <SupportMessageComposer
                    disabled={!canResolve}
                    sending={sending}
                    onSend={sendMessage}
                  />
                </>
              )}
            </>
          )}
        </section>
      </div>

      {resolveOpen && (
        <ModalPortal isOpen={resolveOpen} onClose={() => setResolveOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h4 className="text-base font-semibold text-gray-900">Mark as fixed</h4>
            <p className="mt-2 text-sm text-gray-600">
              The client and marketing staff will be notified that this issue has been resolved.
            </p>
            <label className="mt-4 block text-sm font-medium text-gray-700" htmlFor="resolve-note">
              Resolution note (optional)
            </label>
            <textarea
              id="resolve-note"
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="Brief summary of the fix..."
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResolveOpen(false)}
                disabled={resolving}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleResolve()}
                disabled={resolving}
                className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                {resolving ? "Saving..." : "Confirm"}
              </button>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
