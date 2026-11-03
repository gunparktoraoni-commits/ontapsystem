"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import {
  PORTAL_ACCENTS,
  PortalDataTable,
  PortalEmptyState,
  PortalMobileCard,
  PortalMobileCardList,
  PortalMobileCardRow,
  PortalModal,
  PortalPageHeader,
  PortalPanel,
  PortalStatCard,
  PortalTableBody,
  PortalTableCell,
  PortalTableHead,
  PortalTableHeaderCell,
  PortalTableRow,
  PortalToastStack,
  PortalToolbar,
  usePortalToasts,
} from "./ui";
import { InlineLoader } from "@/app/components/Loader";

type RecycleBinRow = {
  bizcard_id: string;
  user_id: string;
  user_email: string | null;
  serial_id: string | null;
  name: string;
  subscription_tier: string | null;
  subscription_plan_name: string | null;
  deleted_at: string;
};

type ApiResponse = {
  success: boolean;
  data?: {
    rows: RecycleBinRow[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
      has_next: boolean;
      has_previous: boolean;
    };
  };
  error?: { message?: string } | string;
};

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

async function fetchCsrfToken(api: string): Promise<string | null> {
  try {
    const res = await fetch(`${api}/api/csrf-token`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const token =
      (typeof payload?.csrfToken === "string" && payload.csrfToken) ||
      (typeof payload?.token === "string" && payload.token) ||
      null;
    return token?.trim() || null;
  } catch {
    return null;
  }
}

function formatDeletedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function RecycleBinPanel() {
  const API = getFrontendApiBaseUrl();
  const { toasts, push: pushToast, dismiss: dismissToast } = usePortalToasts();
  const [rows, setRows] = useState<RecycleBinRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<RecycleBinRow | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<RecycleBinRow | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "20",
      });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`${API}/api/superadmin/recycle-bin?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok || !payload?.success || !payload.data) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : payload?.error?.message ?? "Failed to load Recycle Bin.",
        );
      }
      setRows(payload.data.rows);
      setPages(payload.data.pagination.pages);
      setTotal(payload.data.pagination.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Recycle Bin.");
      setRows([]);
      setPages(1);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [API, page, search]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const removeRowLocally = useCallback((bizcardId: string) => {
    setRows((prev) => prev.filter((r) => r.bizcard_id !== bizcardId));
    setTotal((prev) => Math.max(0, prev - 1));
  }, []);

  const handleRestore = useCallback(async () => {
    if (!restoreTarget) return;
    setActionLoading(true);
    setBusyId(restoreTarget.bizcard_id);
    try {
      const csrfToken = await fetchCsrfToken(API);
      const res = await fetch(
        `${API}/api/superadmin/recycle-bin/${encodeURIComponent(restoreTarget.bizcard_id)}/restore`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
          },
        },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) {
        throw new Error(extractErrorMessage(payload, "Failed to restore user. Please try again."));
      }
      removeRowLocally(restoreTarget.bizcard_id);
      setRestoreTarget(null);
      pushToast("success", "User restored successfully.");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Failed to restore user.");
    } finally {
      setActionLoading(false);
      setBusyId(null);
    }
  }, [API, pushToast, removeRowLocally, restoreTarget]);

  const handlePermanentDelete = useCallback(async () => {
    if (!purgeTarget) return;
    setActionLoading(true);
    setBusyId(purgeTarget.bizcard_id);
    try {
      const csrfToken = await fetchCsrfToken(API);
      const res = await fetch(
        `${API}/api/superadmin/recycle-bin/${encodeURIComponent(purgeTarget.bizcard_id)}`,
        {
          method: "DELETE",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
          },
        },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) {
        throw new Error(
          extractErrorMessage(payload, "Failed to permanently delete user. Please try again."),
        );
      }
      removeRowLocally(purgeTarget.bizcard_id);
      setPurgeTarget(null);
      pushToast("success", "User permanently deleted.");
    } catch (err) {
      pushToast(
        "error",
        err instanceof Error ? err.message : "Failed to permanently delete user.",
      );
    } finally {
      setActionLoading(false);
      setBusyId(null);
    }
  }, [API, pushToast, purgeTarget, removeRowLocally]);

  return (
    <section className="space-y-5 sm:space-y-6">
      <PortalPageHeader
        title="Recycle Bin"
        subtitle="Restore soft-deleted users or permanently remove them and all associated data."
      />

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
        <PortalStatCard
          label="Items in Recycle Bin"
          value={String(total)}
          icon={Trash2}
          accent={PORTAL_ACCENTS.danger}
          loading={loading}
        />
      </div>

      <PortalToolbar
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="Search serial ID, name, or email..."
      />

      <PortalMobileCardList>
        {rows.map((row) => (
          <PortalMobileCard key={row.bizcard_id}>
            <div className="mb-3">
              <p className="text-sm font-bold text-gray-900">{row.name}</p>
              <p className="text-xs text-gray-500">{row.user_email ?? "No email"}</p>
            </div>
            <div className="space-y-1">
              <PortalMobileCardRow label="Serial ID" value={row.serial_id ?? "—"} />
              <PortalMobileCardRow label="Deleted" value={formatDeletedAt(row.deleted_at)} />
              <PortalMobileCardRow
                label="Subscription"
                value={row.subscription_plan_name ?? row.subscription_tier ?? "—"}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setRestoreTarget(row)}
                disabled={busyId === row.bizcard_id}
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" />
                Restore
              </button>
              <button
                type="button"
                onClick={() => setPurgeTarget(row)}
                disabled={busyId === row.bizcard_id}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                Permanently Delete
              </button>
            </div>
          </PortalMobileCard>
        ))}
      </PortalMobileCardList>

      <PortalPanel className="hidden lg:block">
        {!loading && rows.length === 0 ? (
          <PortalEmptyState
            title="Recycle Bin is empty"
            description="Soft-deleted users will appear here until restored or permanently deleted."
          />
        ) : (
          <PortalDataTable>
            <PortalTableHead>
              <PortalTableRow>
                <PortalTableHeaderCell>Name</PortalTableHeaderCell>
                <PortalTableHeaderCell>Email</PortalTableHeaderCell>
                <PortalTableHeaderCell>Serial ID</PortalTableHeaderCell>
                <PortalTableHeaderCell>Deleted</PortalTableHeaderCell>
                <PortalTableHeaderCell>Actions</PortalTableHeaderCell>
              </PortalTableRow>
            </PortalTableHead>
            <PortalTableBody>
              {loading && rows.length === 0 ? (
                <PortalTableRow>
                  <PortalTableCell className="py-10 text-center text-sm text-gray-500">
                    <InlineLoader />
                  </PortalTableCell>
                </PortalTableRow>
              ) : null}
              {rows.map((row) => (
                <PortalTableRow key={row.bizcard_id}>
                  <PortalTableCell className="font-semibold text-gray-900">{row.name}</PortalTableCell>
                  <PortalTableCell>{row.user_email ?? "—"}</PortalTableCell>
                  <PortalTableCell>{row.serial_id ?? "—"}</PortalTableCell>
                  <PortalTableCell>{formatDeletedAt(row.deleted_at)}</PortalTableCell>
                  <PortalTableCell>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setRestoreTarget(row)}
                        disabled={busyId === row.bizcard_id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Restore
                      </button>
                      <button
                        type="button"
                        onClick={() => setPurgeTarget(row)}
                        disabled={busyId === row.bizcard_id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </div>
                  </PortalTableCell>
                </PortalTableRow>
              ))}
            </PortalTableBody>
          </PortalDataTable>
        )}

        {pages > 1 ? (
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-gray-100 px-1 pt-4">
            <p className="text-xs text-gray-500">
              Page {page} of {pages} ({total} total)
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= pages || loading}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </PortalPanel>

      <PortalModal
        open={Boolean(restoreTarget)}
        onClose={() => {
          if (!actionLoading) setRestoreTarget(null);
        }}
        title="Restore User"
        description={restoreTarget ? `Restore ${restoreTarget.name} from the Recycle Bin?` : undefined}
        preventClose={actionLoading}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRestoreTarget(null)}
              disabled={actionLoading}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleRestore()}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {actionLoading ? (
                <>
                  <InlineLoader />
                  Restoring...
                </>
              ) : (
                <>
                  <RotateCcw className="h-4 w-4" />
                  Restore
                </>
              )}
            </button>
          </div>
        }
      >
        <p className="text-sm text-gray-700">
          The user account and associated BizCard data will be restored and available again in User
          BizCards.
        </p>
      </PortalModal>

      <PortalModal
        open={Boolean(purgeTarget)}
        onClose={() => {
          if (!actionLoading) setPurgeTarget(null);
        }}
        title="Permanently Delete User"
        description={
          purgeTarget ? `This action cannot be undone for ${purgeTarget.name}.` : undefined
        }
        preventClose={actionLoading}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPurgeTarget(null)}
              disabled={actionLoading}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handlePermanentDelete()}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {actionLoading ? (
                <>
                  <InlineLoader />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Permanently Delete
                </>
              )}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Are you sure you want to permanently delete this user and all associated data?{" "}
            <span className="font-semibold text-rose-600">This action cannot be undone.</span>
          </p>
          {purgeTarget ? (
            <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-800 space-y-1">
              <p>
                <span className="font-semibold">Name:</span> {purgeTarget.name}
              </p>
              {purgeTarget.user_email ? (
                <p>
                  <span className="font-semibold">Email:</span> {purgeTarget.user_email}
                </p>
              ) : null}
              {purgeTarget.serial_id ? (
                <p>
                  <span className="font-semibold">Serial ID:</span> {purgeTarget.serial_id}
                </p>
              ) : null}
            </div>
          ) : null}
          <p className="text-xs text-gray-500">
            This will permanently remove the user account, BizCard, services, social links, gallery
            items, connections, inquiries, sessions, and all related records from the database.
          </p>
        </div>
      </PortalModal>

      <PortalToastStack toasts={toasts} onDismiss={dismissToast} />
    </section>
  );
}
