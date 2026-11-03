"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Calendar, Check, Filter, RefreshCcw, Users, X } from "lucide-react";
import { SkeletonLoader } from "../../components/Loader";
import { showConfirmDialog } from "@/app/components/ConfirmDialog";

type RequestTab = "pending" | "resolved";

type ApiPendingRequest = {
  request_id?: string | number;
  id?: string | number;
  company_name?: string;
  companyName?: string;
  client_name?: string;
  clientName?: string;
  client_email?: string;
  clientEmail?: string;
  created_at?: string;
  requestDate?: string;
  status?: string;
  subscription_tier?: string | null;
  created_by?: { user_id?: string | number; name?: string; email?: string } | null;
};

type PendingRequest = {
  id: string;
  companyName: string;
  clientName: string;
  clientEmail: string;
  requestDate: string;
  status: string;
  subscriptionTier: string;
};

type PendingRequestsResponse = {
  data?: {
    requests?: ApiPendingRequest[];
    pagination?: { total?: number; pages?: number };
  };
  error?: { message?: string } | string;
  message?: string;
};

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
  process.env.NEXT_PUBLIC_API_URL?.trim() ||
  ''
).replace(/\/+$/, "");
const CSRF_COOKIE_NAME = "csrf-token";
const COMPANY_PENDING_ENDPOINT = "/api/company/pending-requests";
const COMPANY_APPROVE_ENDPOINT = "/api/company/approve";
const PAGE_SIZE = 10;

function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return (
    window.localStorage.getItem("auth_token") ||
    window.localStorage.getItem("superadmin_token") ||
    window.sessionStorage.getItem("auth_token") ||
    window.sessionStorage.getItem("superadmin_token") ||
    null
  );
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/([.*+?^${}()|[\]\\])/g, "\\$1")}=([^;]*)`)
  );
  return match ? decodeURIComponent(match[1]) : null;
}

async function fetchCsrfTokenFromServer(): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/csrf-token`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });

    if (!response.ok) {
      return readCookie(CSRF_COOKIE_NAME);
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const data = payload && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : null;
    const token =
      (payload && typeof payload.csrfToken === "string" && payload.csrfToken) ||
      (payload && typeof payload.csrf_token === "string" && payload.csrf_token) ||
      (payload && typeof payload.token === "string" && payload.token) ||
      (data && typeof data.csrfToken === "string" && data.csrfToken) ||
      null;

    return token?.trim() || readCookie(CSRF_COOKIE_NAME);
  } catch {
    return readCookie(CSRF_COOKIE_NAME);
  }
}

async function ensureCsrfToken(forceRefresh = false): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (!forceRefresh) {
    const fromCookie = readCookie(CSRF_COOKIE_NAME);
    if (fromCookie) return fromCookie;
  }

  return fetchCsrfTokenFromServer();
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const obj = payload as { error?: { message?: string } | string; message?: string };
  if (typeof obj.error === "string") return obj.error;
  if (obj.error?.message) return obj.error.message;
  return obj.message ?? fallback;
}

function extractErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as { code?: string; error?: { code?: string } | string };
  if (typeof obj.code === "string") return obj.code;
  if (obj.error && typeof obj.error === "object" && typeof obj.error.code === "string") return obj.error.code;
  return null;
}

function isCsrfError(status: number, payload: unknown): boolean {
  if (status !== 403) return false;
  const code = extractErrorCode(payload);
  if (code === "INVALID_CSRF_TOKEN") return true;
  const message = extractErrorMessage(payload, "");
  return /csrf/i.test(message);
}

function mapPendingRequest(item: ApiPendingRequest): PendingRequest {
  return {
    id: String(item.request_id ?? item.id ?? ""),
    companyName: item.company_name ?? item.companyName ?? "Unknown Company",
    clientName: item.client_name ?? item.clientName ?? item.created_by?.name ?? "Unknown Client",
    clientEmail: item.client_email ?? item.clientEmail ?? item.created_by?.email ?? "N/A",
    requestDate: item.created_at ?? item.requestDate ?? new Date().toISOString(),
    status: (item.status ?? "pending").toLowerCase(),
    subscriptionTier: item.subscription_tier ?? "n/a",
  };
}

function toTitleCase(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function statusBadgeClass(status: string): string {
  if (status === "approved" || status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "rejected" || status === "declined") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export default function CompanyCreationRequestsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<RequestTab>("pending");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [page, setPage] = useState(1);
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRequests, setTotalRequests] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [actionLoadingById, setActionLoadingById] = useState<Record<string, "approve" | "reject" | undefined>>({});

  const fetchPendingRequests = useCallback(
    async (mode: "initial" | "refresh" = "initial"): Promise<void> => {
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);
      try {
        const token = readStoredToken();
        const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
        const response = await fetch(`${API_BASE_URL}${COMPANY_PENDING_ENDPOINT}?${params.toString()}`, {
          method: "GET",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        const payload = (await response.json()) as PendingRequestsResponse;
        if (!response.ok) throw new Error(extractErrorMessage(payload, "Failed to load pending requests."));
        const mapped = (payload.data?.requests ?? []).map(mapPendingRequest);
        setRequests(mapped);
        setTotalPages(Math.max(1, payload.data?.pagination?.pages ?? 1));
        setTotalRequests(payload.data?.pagination?.total ?? mapped.length);
      } catch (error) {
        setRequests([]);
        setTotalPages(1);
        setTotalRequests(0);
        setNotice({ type: "error", message: error instanceof Error ? error.message : "Failed to load pending requests." });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [page, search, statusFilter]
  );

  useEffect(() => {
    void fetchPendingRequests("initial");
  }, [fetchPendingRequests]);

  useEffect(() => {
    const timer = window.setInterval(() => void fetchPendingRequests("refresh"), 30000);
    return () => window.clearInterval(timer);
  }, [fetchPendingRequests]);


  
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === "superadmin_pending_requests_refresh") void fetchPendingRequests("refresh");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [fetchPendingRequests]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const filteredRequests = useMemo(() => {
    const query = search.trim().toLowerCase();
    const tabRows = requests.filter((request) => (tab === "pending" ? request.status === "pending" : request.status !== "pending"));
    if (!query) return tabRows;
    return tabRows.filter((request) =>
      [request.companyName, request.clientName, request.clientEmail].some((value) => value.toLowerCase().includes(query))
    );
  }, [requests, search, tab]);
  const pendingBadgeCount = useMemo(() => requests.filter((request) => request.status === "pending").length, [requests]);
  async function handleReviewRequest(request: PendingRequest, action: "approve" | "reject"): Promise<void> {
    if (!(await showConfirmDialog({
      title: action === "approve" ? "Approve company request?" : "Reject company request?",
      message:
        action === "approve"
          ? `${request.clientName} will be approved as the admin for ${request.companyName}.`
          : `${request.clientName}'s request to create ${request.companyName} will be declined.`,
      confirmLabel: action === "approve" ? "Approve" : "Reject",
      variant: action === "approve" ? "primary" : "danger",
    }))) return;
    const rejectionReason = "";
    setActionLoadingById((prev) => ({ ...prev, [request.id]: action }));
    setNotice(null);
    try {
      const token = readStoredToken();
      const submit = async (csrfToken: string | null) =>
        fetch(`${API_BASE_URL}${COMPANY_APPROVE_ENDPOINT}`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
          },
          body: JSON.stringify({
            request_id: request.id,
            action,
            ...(action === "reject" && rejectionReason ? { rejection_reason: rejectionReason } : {}),
          }),
        });

      const csrfToken = await ensureCsrfToken();
      let response = await submit(csrfToken);
      let payload = await response.json().catch(() => ({}));

      if (!response.ok && isCsrfError(response.status, payload)) {
        const refreshedToken = await ensureCsrfToken(true);
        if (refreshedToken && refreshedToken !== csrfToken) {
          response = await submit(refreshedToken);
          payload = await response.json().catch(() => ({}));
        }
      }

      if (!response.ok) throw new Error(extractErrorMessage(payload, `Failed to ${action} request.`));
      setNotice({
        type: "success",
        message: action === "approve" ? "Client has been approved as admin." : "Pending request rejected successfully.",
      });
      window.localStorage.setItem("superadmin_pending_requests_refresh", String(Date.now()));
      await fetchPendingRequests("refresh");
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : `Failed to ${action} request.` });
    } finally {
      setActionLoadingById((prev) => ({ ...prev, [request.id]: undefined }));
    }
  }
  return (
    <section className="space-y-6">
      <header className="space-y-4">
        <button
          type="button"
          onClick={() => router.push("/superadmin/company-list")}
          className="inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Company list
        </button>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-bold text-gray-900">Pending Company Admin Requests</h2>
              <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">
                {pendingBadgeCount} Pending
              </span>
            </div>
          </div>
          <div className="inline-flex w-full items-center rounded-xl border border-gray-100 bg-[#fbfdff] p-1 sm:w-auto">
            <button
              type="button"
              onClick={() => setTab("pending")}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold ${tab === "pending" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
            >
              Pending
            </button>
            <button
              type="button"
              onClick={() => setTab("resolved")}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold ${tab === "resolved" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
            >
              Resolved
            </button>
          </div>
        </div>
      </header>

      {notice && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${notice.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          {notice.message}
        </div>
      )}

      <section className="space-y-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative w-full lg:flex-1">
            <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search by company, client, or email..."
              className="w-full rounded-lg border border-gray-100 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 outline-none"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as "all" | "pending" | "approved" | "rejected");
              setPage(1);
            }}
            className="h-11 rounded-lg border border-gray-100 bg-white px-3 text-sm font-semibold text-gray-900"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>

          <button
            type="button"
            onClick={() => void fetchPendingRequests("refresh")}
            disabled={refreshing}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-gray-100 bg-white px-4 text-sm font-semibold text-gray-900 disabled:opacity-60"
          >
            <RefreshCcw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[#e2e9f6]">
          <table className="min-w-230 w-full border-collapse">
            <thead className="bg-[#f8fbff]">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Requested</th>
                <th className="px-4 py-3">Subscription</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {loading ? (
                Array.from({ length: 6 }).map((_, index) => (
                  <tr key={`skeleton-${index}`} className="border-t border-[#eef3ff]">
                    <td colSpan={6} className="px-4 py-4">
                      <SkeletonLoader width="w-full" height="h-4" className="rounded" />
                    </td>
                  </tr>
                ))
              ) : filteredRequests.length ? (
                filteredRequests.map((request) => (
                  <tr key={request.id} className="border-t border-[#eef3ff] text-sm">
                    <td className="px-4 py-4 font-semibold text-gray-900">{request.companyName}</td>
                    <td className="px-4 py-4">
                      <p className="font-semibold text-gray-900">{request.clientName}</p>
                      <p className="text-xs text-gray-500">{request.clientEmail}</p>
                    </td>
                    <td className="px-4 py-4 text-[#5f739d]">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5 text-[#9aa8c9]" />
                        {new Date(request.requestDate).toLocaleDateString()}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span className="inline-flex rounded-full border border-gray-100 bg-[#f8fbff] px-2.5 py-1 text-xs font-semibold text-gray-900">
                        {toTitleCase(request.subscriptionTier)}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(request.status)}`}>
                        {toTitleCase(request.status)}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-end gap-2">
                        {request.status === "pending" ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleReviewRequest(request, "reject")}
                              disabled={!!actionLoadingById[request.id]}
                              className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 disabled:opacity-60"
                            >
                              <X className="h-3.5 w-3.5" />
                              {actionLoadingById[request.id] === "reject" ? "Rejecting..." : "Reject"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleReviewRequest(request, "approve")}
                              disabled={!!actionLoadingById[request.id]}
                              className="inline-flex items-center gap-2 rounded-lg border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                            >
                              <Check className="h-3.5 w-3.5" />
                              {actionLoadingById[request.id] === "approve" ? "Approving..." : "Approve"}
                            </button>
                          </>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                            <Users className="h-3.5 w-3.5" />
                            Processed
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr className="border-t border-[#eef3ff]">
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">
                    No requests match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-2 flex flex-col gap-3 border-t border-[#edf2fb] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-500">
            Page <span className="font-semibold text-gray-900">{page}</span> of <span className="font-semibold text-gray-900">{totalPages}</span> |{" "}
            <span className="font-semibold text-gray-900">{totalRequests}</span> total
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              className="rounded-md border border-gray-100 px-3 py-1.5 text-sm font-semibold text-gray-900 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              className="rounded-md border border-gray-100 px-3 py-1.5 text-sm font-semibold text-gray-900 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </section>
  );
}
