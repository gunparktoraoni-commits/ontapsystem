"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Edit3, Filter, MessageSquare, Search, Trash2, Users } from "lucide-react";
import { SectionLoader, InlineLoader } from "../../components/Loader";
import { getFrontendApiBaseUrl } from "../../components/apiBase";
import { csrfClient } from "@/lib/csrf-client";
import { buildAuthHeaders } from "./StaffBizCardPanels";
import { showConfirmDialog } from "@/app/components/ConfirmDialog";
import { showInputDialog } from "@/app/components/InputDialog";

const API = getFrontendApiBaseUrl();

type AssignmentFilter = "all" | "my";

interface AssignedClient {
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  company_name: string | null;
  assigned_at: string;
  is_primary: boolean;
  is_active: boolean;
  unread_inquiries: number;
  recent_order_count: number;
  card_count: number;
}

function displayName(client: AssignedClient): string {
  const full = [client.first_name, client.last_name].filter(Boolean).join(" ").trim();
  return full || client.email;
}

export default function ClientServices() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [clients, setClients] = useState<AssignedClient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>("all");
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement>(null);

  const loadClients = useCallback(async () => {
    setLoading(true);
    setError(null);
    setActionError(null);
    try {
      const params = new URLSearchParams({ limit: "50", status: "all" });
      if (search.trim()) params.set("search", search.trim());
      const response = await fetch(`${API}/api/staff/portal/clients?${params}`, {
        credentials: "include",
        headers: buildAuthHeaders(),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to load clients.");
      }
      setClients((payload?.data?.clients ?? []) as AssignedClient[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load clients.");
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadClients();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loadClients]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) {
        setFilterMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filteredClients = useMemo(() => {
    if (assignmentFilter === "my") {
      return clients.filter((client) => client.is_primary);
    }
    return clients;
  }, [clients, assignmentFilter]);

  const handleMessage = useCallback(
    async (clientId: string) => {
      setActionLoading(clientId);
      setActionError(null);
      try {
        const opts = await csrfClient.getFetchOptions("POST", {
          clientUserId: clientId,
        });
        const response = await fetch(
          `${API}/api/staff/support/conversations/start`,
          opts,
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const err = payload?.error;
          const message =
            typeof err === "object"
              ? (err?.message ?? "Failed to start conversation.")
              : (err ?? "Failed to start conversation.");
          throw new Error(message);
        }

        const conversationId = payload?.data?.id;
        if (!conversationId) {
          throw new Error("Invalid server response.");
        }
        router.push(`/staff/messages/${conversationId}`);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to start conversation.");
      } finally {
        setActionLoading(null);
      }
    },
    [router]
  );

  const handleEditClient = useCallback(
    async (client: AssignedClient) => {
      const result = await showInputDialog({
        title: "Edit Client Name",
        description: "Update the client's display name.",
        fields: [
          {
            key: "firstName",
            label: "First Name",
            placeholder: "e.g. Juan",
            defaultValue: client.first_name ?? "",
          },
          {
            key: "lastName",
            label: "Last Name",
            placeholder: "e.g. Dela Cruz",
            defaultValue: client.last_name ?? "",
          },
        ],
        submitLabel: "Save Changes",
      });
      if (result === null) return;
      const firstName = result.firstName;
      const lastName = result.lastName;

      setActionLoading(client.user_id);
      setActionError(null);
      try {
        const response = await fetch(`${API}/api/staff/portal/clients/${client.user_id}`, {
          method: "PUT",
          credentials: "include",
          headers: {
            ...buildAuthHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            first_name: firstName.trim() || null,
            last_name: lastName.trim() || null,
          }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error?.message ?? "Failed to update client.");
        }
        await loadClients();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to update client.");
      } finally {
        setActionLoading(null);
      }
    },
    [loadClients]
  );

  const handleDropClient = useCallback(
    async (clientId: string, clientName: string) => {
      const confirmed = await showConfirmDialog({
        title: "Remove client from your list?",
        message: `${clientName} will be removed from your assigned clients. You can be assigned to them again later if needed.`,
        confirmLabel: "Remove client",
        variant: "danger",
      });
      if (!confirmed) return;
      setActionLoading(clientId);
      setActionError(null);
      try {
        const response = await fetch(`${API}/api/staff/portal/clients/${clientId}`, {
          method: "DELETE",
          credentials: "include",
          headers: buildAuthHeaders(),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error?.message ?? "Failed to drop client.");
        }
        await loadClients();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to drop client.");
      } finally {
        setActionLoading(null);
      }
    },
    [loadClients]
  );

  const activeFilterLabel =
    assignmentFilter === "my" ? "My Clients" : "All Clients";

  if (loading && clients.length === 0) {
    return <SectionLoader text="Loading assigned clients..." />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center justify-between">


        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search assigned clients..."
            className="w-full rounded-xl border border-gray-200 bg-white pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <div className="relative" ref={filterMenuRef}>
          <button
            type="button"
            onClick={() => setFilterMenuOpen((value) => !value)}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Filter className="h-4 w-4" />
            {activeFilterLabel}
            <ChevronDown className="h-4 w-4" />
          </button>
          {filterMenuOpen && (
            <div className="absolute right-0 mt-2 w-44 rounded-xl border border-gray-100 bg-white py-1 shadow-lg z-20">
              <button
                type="button"
                onClick={() => {
                  setAssignmentFilter("all");
                  setFilterMenuOpen(false);
                }}
                className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
              >
                All 
              </button>
              <button
                type="button"
                onClick={() => {
                  setAssignmentFilter("my");
                  setFilterMenuOpen(false);
                }}
                className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
              >
                My Clients
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}
      {actionError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {actionError}
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-3xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <InlineLoader />
          </div>
        ) : filteredClients.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-16">
            {assignmentFilter === "my"
              ? "No primary clients assigned to you."
              : "No assigned clients found."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-5 py-4">Client Name</th>
                  <th className="px-5 py-4">Role</th>
                  <th className="px-5 py-4">Company</th>
                  <th className="px-5 py-4">Cards</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {filteredClients.map((client) => (
                  <tr key={client.user_id} className="hover:bg-gray-50">
                    <td className="px-5 py-4 align-top">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <Users className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900">{displayName(client)}</p>
                          <p className="text-xs text-gray-500 truncate">{client.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 align-top text-sm text-gray-700">
                      {client.role || "—"}
                    </td>
                    <td className="px-5 py-4 align-top text-sm text-gray-700">
                      {client.company_name || "—"}
                    </td>
                    <td className="px-5 py-4 align-top text-sm text-gray-700">
                      {client.card_count}
                    </td>
                    <td className="px-5 py-4 align-top">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold ${
                          client.is_active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-rose-100 text-rose-700"
                        }`}
                      >
                        {client.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-5 py-4 align-top text-right">
                      <div className="inline-flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => void handleMessage(client.user_id)}
                          disabled={actionLoading === client.user_id}
                          title="Message this client"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary-light text-white transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <MessageSquare className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleEditClient(client)}
                          disabled={actionLoading === client.user_id}
                          title="Edit client"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDropClient(client.user_id, displayName(client))}
                          disabled={actionLoading === client.user_id}
                          title="Drop client"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-700 transition-colors hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
