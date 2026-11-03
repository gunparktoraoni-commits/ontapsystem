"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Building2, Search, User, X } from "lucide-react";
import { InlineLoader } from "@/app/components/Loader";
import { csrfClient } from "@/lib/csrf-client";
import type {
  StaffSearchCompanyResult,
  StaffSearchUserResult,
} from "@/app/api/staff/support/search/route";
import ClientAvatar from "./ClientAvatar";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type SearchResult =
  | StaffSearchUserResult
  | StaffSearchCompanyResult;

interface SearchResponse {
  success: boolean;
  data?: {
    users: StaffSearchUserResult[];
    companies: StaffSearchCompanyResult[];
    query: string;
  };
  error?: { message?: string } | string;
}

// ─────────────────────────────────────────────────────────────
// Role badge helper
// ─────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  user: "bg-blue-100 text-blue-700",
  admin: "bg-purple-100 text-purple-700",
  super_admin: "bg-red-100 text-red-700",
  staff: "bg-green-100 text-green-700",
  dev: "bg-orange-100 text-orange-700",
};

function roleBadgeClass(role: string): string {
  return ROLE_COLORS[role] ?? "bg-gray-100 text-gray-700";
}

function roleLabel(role: string): string {
  return role
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ─────────────────────────────────────────────────────────────
// StaffUserSearch component
// ─────────────────────────────────────────────────────────────

interface StaffUserSearchProps {
  /** Called when the staff member selects a user result. Receives the conversation ID
   *  (existing or newly created) so the parent can navigate or open the thread. */
  onConversationOpened: (conversationId: string) => void;
}

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 1;

export default function StaffUserSearch({
  onConversationOpened,
}: StaffUserSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{
    users: StaffSearchUserResult[];
    companies: StaffSearchCompanyResult[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [openingUserId, setOpeningUserId] = useState<string | null>(null);
  const [expandedCompanyId, setExpandedCompanyId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Search API call ────────────────────────────────────────

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < MIN_QUERY_LENGTH) {
      setResults(null);
      setOpen(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ q: q.trim() });
      const res = await fetch(
        `/api/staff/support/search?${params.toString()}`,
        { credentials: "include", cache: "no-store" },
      );

      const payload = (await res.json().catch(() => ({}))) as SearchResponse;

      if (!res.ok) {
        const msg =
          typeof payload.error === "object"
            ? (payload.error?.message ?? "Search failed")
            : (payload.error ?? "Search failed");
        throw new Error(msg);
      }

      setResults({
        users: payload.data?.users ?? [],
        companies: payload.data?.companies ?? [],
      });
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Debounced input handler ────────────────────────────────

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (val.trim().length < MIN_QUERY_LENGTH) {
      setResults(null);
      setOpen(false);
      setError(null);
      return;
    }

    debounceRef.current = setTimeout(() => {
      void runSearch(val);
    }, DEBOUNCE_MS);
  };

  // ── Close dropdown on outside click ───────────────────────

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Cleanup debounce on unmount ────────────────────────────

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ── Open or create conversation for a user ─────────────────

  const openUserConversation = useCallback(
    async (user: StaffSearchUserResult) => {
      setOpeningUserId(user.id);
      setError(null);

      try {
        // If there's already a conversation, navigate straight to it.
        if (user.conversationId) {
          setOpen(false);
          setQuery("");
          setResults(null);
          onConversationOpened(user.conversationId);
          router.push(`/staff/messages/${user.conversationId}`);
          return;
        }

        // Otherwise, create a new conversation by POSTing to the support endpoint.
        // The server's getOrCreateConversationForClient is triggered via the user's
        // own conversation endpoint; staff use POST /api/staff/support/conversations/start
        // which we'll create inline here using the existing assign pattern.
        //
        // In this system a SupportConversation is auto-created when a user messages first.
        // Staff can trigger creation by calling the "create" helper on the service.
        // We POST to /api/staff/support/conversations with the clientUserId.
        const opts = await csrfClient.getFetchOptions("POST", {
          clientUserId: user.id,
        });
        const res = await fetch(
          "/api/staff/support/conversations/start",
          opts,
        );
        const payload = await res
          .json()
          .catch(() => ({} as Record<string, unknown>));

        if (!res.ok) {
          const msg =
            (payload as { error?: { message?: string } | string })?.error;
          throw new Error(
            typeof msg === "object"
              ? (msg?.message ?? "Failed to start conversation")
              : (msg ?? "Failed to start conversation"),
          );
        }

        const convId = (
          payload as { data?: { id?: string } }
        )?.data?.id;
        if (!convId) throw new Error("Invalid server response");

        setOpen(false);
        setQuery("");
        setResults(null);
        onConversationOpened(convId);
        router.push(`/staff/messages/${convId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to open conversation");
      } finally {
        setOpeningUserId(null);
      }
    },
    [onConversationOpened, router],
  );

  // ── Company expand/collapse ───────────────────────────────

  const toggleCompany = (id: string) => {
    setExpandedCompanyId((prev) => (prev === id ? null : id));
  };

  // ── Derived state ─────────────────────────────────────────

  const hasResults =
    results !== null &&
    (results.users.length > 0 || results.companies.length > 0);

  const noResults =
    results !== null &&
    results.users.length === 0 &&
    results.companies.length === 0;

  // ── Render ────────────────────────────────────────────────

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Search input */}
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={handleChange}
          onFocus={() => {
            if (results !== null && query.trim().length >= MIN_QUERY_LENGTH) {
              setOpen(true);
            }
          }}
          placeholder="Find any user or company…"
          aria-label="Search users and companies"
          aria-autocomplete="list"
          aria-expanded={open}
          autoComplete="off"
          className="w-full rounded-xl border border-[#C8D4EB] bg-white pl-10 pr-9 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4785B8]/30 placeholder:text-gray-400"
        />
        {/* Loading / clear icons */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
          {loading ? (
            <InlineLoader />
          ) : query.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setResults(null);
                setOpen(false);
                setError(null);
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Error toast */}
      {error && (
        <div
          role="alert"
          className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 flex items-center justify-between gap-2"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="shrink-0 text-rose-500 hover:text-rose-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Dropdown */}
      {open && (
        <div
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 top-full mt-1 z-30 max-h-[28rem] overflow-y-auto rounded-2xl border border-gray-100 bg-white shadow-xl"
        >
          {noResults && (
            <div className="px-4 py-6 text-center text-sm text-gray-500">
              No users or companies found for &ldquo;{query}&rdquo;.
            </div>
          )}

          {/* ── Users section ───────────────────────────── */}
          {(results?.users?.length ?? 0) > 0 && (
            <div>
              <div className="sticky top-0 bg-gray-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-100">
                Users
              </div>
              {results!.users.map((user) => (
                <UserResultRow
                  key={user.id}
                  user={user}
                  isOpening={openingUserId === user.id}
                  onSelect={openUserConversation}
                />
              ))}
            </div>
          )}

          {/* ── Companies section ────────────────────────── */}
          {(results?.companies?.length ?? 0) > 0 && (
            <div>
              <div className="sticky top-0 bg-gray-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-100">
                Companies
              </div>
              {results!.companies.map((company) => (
                <CompanyResultRow
                  key={company.id}
                  company={company}
                  isExpanded={expandedCompanyId === company.id}
                  onToggle={() => toggleCompany(company.id)}
                  onSelectAdmin={(adminId) => {
                    // Find admin user in users results or trigger open via adminId
                    // We synthesise a minimal user object for navigation
                    if (!company.adminId) return;
                    const adminUser: StaffSearchUserResult = {
                      type: "user",
                      id: company.adminId,
                      name: company.adminName ?? "Company Admin",
                      email: "",
                      role: "admin",
                      companyName: company.name,
                      profileUrl: null,
                      conversationId: null,
                    };
                    void openUserConversation(adminUser);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// UserResultRow
// ─────────────────────────────────────────────────────────────

function UserResultRow({
  user,
  isOpening,
  onSelect,
}: {
  user: StaffSearchUserResult;
  isOpening: boolean;
  onSelect: (u: StaffSearchUserResult) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={false}
      disabled={isOpening}
      onClick={() => onSelect(user)}
      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#F4F7FC] transition-colors disabled:opacity-60 disabled:cursor-not-allowed border-b border-gray-50 last:border-b-0"
    >
      <ClientAvatar name={user.name} profileUrl={user.profileUrl} size="sm" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900 truncate">
            {user.name}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${roleBadgeClass(user.role)}`}
          >
            {roleLabel(user.role)}
          </span>
          {user.conversationId && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-700">
              Active
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 truncate">{user.email}</p>
        {user.companyName && (
          <p className="text-xs text-gray-400 truncate">
            <Building2 className="inline h-3 w-3 mr-0.5 align-text-bottom" />
            {user.companyName}
          </p>
        )}
      </div>

      {isOpening ? (
        <InlineLoader />
      ) : (
        <span className="shrink-0 text-xs font-medium text-[#2A4792] whitespace-nowrap">
          {user.conversationId ? "Open Chat" : "Start Chat"}
        </span>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// CompanyResultRow
// ─────────────────────────────────────────────────────────────

function CompanyResultRow({
  company,
  isExpanded,
  onToggle,
  onSelectAdmin,
}: {
  company: StaffSearchCompanyResult;
  isExpanded: boolean;
  onToggle: () => void;
  onSelectAdmin: (adminId: string) => void;
}) {
  return (
    <div className="border-b border-gray-50 last:border-b-0">
      <button
        type="button"
        role="option"
        aria-selected={false}
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#F4F7FC] transition-colors"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
          <Building2 className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900 truncate">
              {company.name}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                company.status === "active"
                  ? "bg-green-100 text-green-700"
                  : company.status === "pending"
                    ? "bg-yellow-100 text-yellow-700"
                    : "bg-gray-100 text-gray-600"
              }`}
            >
              {company.status}
            </span>
          </div>
          <p className="text-xs text-gray-500">
            {company.userCount}{" "}
            {company.userCount === 1 ? "member" : "members"}
            {company.email ? ` · ${company.email}` : ""}
          </p>
        </div>

        <span className="shrink-0 text-xs font-medium text-[#2A4792]">
          {isExpanded ? "Hide" : "Details"}
        </span>
      </button>

      {/* Expanded panel — show admin info & quick actions */}
      {isExpanded && (
        <div className="mx-4 mb-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm space-y-2">
          {company.adminName ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <User className="h-4 w-4 shrink-0 text-gray-400" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-800 truncate">
                    {company.adminName}
                  </p>
                  <p className="text-[10px] text-gray-400">Company Admin</p>
                </div>
              </div>
              {company.adminId && (
                <button
                  type="button"
                  onClick={() => onSelectAdmin(company.adminId!)}
                  className="shrink-0 inline-flex items-center rounded-lg bg-[#2A4792] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1e3568] transition-colors"
                >
                  Message Admin
                </button>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-400">No admin assigned.</p>
          )}
        </div>
      )}
    </div>
  );
}
