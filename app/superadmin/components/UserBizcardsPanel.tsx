"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Percent, Pencil, QrCode, ShieldBan, ShieldCheck, Trash2 } from "lucide-react";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import {
  BIZCARD_SUBSCRIPTION_TIERS,
  DEFAULT_BIZCARD_SUBSCRIPTION_TIER,
  formatBizcardSubscriptionTierLabel,
  type BizcardSubscriptionTier,
} from "@/lib/bizcard/tiers";
import {
  PORTAL_ACCENTS,
  PortalBadge,
  PortalDataTable,
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

type BizcardRow = {
  bizcard_id: string;
  user_id: string;
  user_email: string | null;
  serial_id: string | null;
  name: string;
  subscription_tier: string | null;
  subscription_plan_name: string | null;
  subscription_status: string | null;
  qr_code_url: string | null;
  portfolio_url: string | null;
  restricted: boolean;
  created_at: string;
  owner_is_online?: boolean;
  owner_last_active?: string | null;
  owner_session_status?: "online" | "offline";
  city?: string | null;
  region?: string | null;
};

function bizcardLocationLabel(row: Pick<BizcardRow, "city" | "region">): string {
  const city = row.city?.trim();
  if (city) return city;
  const region = row.region?.trim();
  if (region) return region;
  return "—";
}

type BizcardDetail = BizcardRow & {
  url_alias: string | null;
  portfolio_url_editable: boolean;
};

type EditFormState = {
  subscriptionTier: BizcardSubscriptionTier;
  portfolioUrl: string;
  portfolioUrlEditable: boolean;
};

type ApiResponse = {
  success: boolean;
  data?: {
    rows: BizcardRow[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
      has_next: boolean;
      has_previous: boolean;
    };
    /** Global counts across the entire dataset — not affected by filter or search. */
    summary: {
      total_active: number;
      total_restricted: number;
      with_serial_id?: number;
      without_serial_id?: number;
    };
  };
  error?: { message?: string } | string;
};
type DetailApiResponse = {
  success: boolean;
  data?: BizcardDetail;
  error?: { message?: string } | string;
};
function parseSubscriptionTierValue(
  value: string | null | undefined,
  fallback: BizcardSubscriptionTier = DEFAULT_BIZCARD_SUBSCRIPTION_TIER,
): BizcardSubscriptionTier {
  const normalized = String(value ?? "").trim().toLowerCase();
  return (BIZCARD_SUBSCRIPTION_TIERS as readonly string[]).includes(normalized)
    ? (normalized as BizcardSubscriptionTier)
    : fallback;
}

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

// Fetch a fresh CSRF token from the server response body.
// Reading from the body (not document.cookie) is immune to SameSite=None;
// Partitioned cookie restrictions that can silently hide the csrf-token cookie.
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

export default function UserBizcardsPanel() {
  const API = getFrontendApiBaseUrl();
  const { toasts, push: pushToast, dismiss: dismissToast } = usePortalToasts();
  const [rows, setRows] = useState<BizcardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "restricted">("all");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  /**
   * Global active count — reflects total active bizcards in the system.
   * Populated from `data.summary.total_active` on every API response.
   * Initialized to null so the stat card shows the loading state until the
   * first response arrives.
   */
  const [totalActive, setTotalActive] = useState<number | null>(null);
  /**
   * Global restricted count — reflects total restricted bizcards in the system.
   * Populated from `data.summary.total_restricted` on every API response.
   */
  const [totalRestricted, setTotalRestricted] = useState<number | null>(null);
  const [withSerialId, setWithSerialId] = useState<number | null>(null);
  const [withoutSerialId, setWithoutSerialId] = useState<number | null>(null);
  const [confirmRow, setConfirmRow] = useState<BizcardRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<BizcardRow | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteConfirmRow, setDeleteConfirmRow] = useState<BizcardRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "20",
        status,
      });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`${API}/api/superadmin/bizcards?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok || !payload?.success || !payload.data) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : payload?.error?.message ?? "Failed to load bizcards.",
        );
      }
      setRows(payload.data.rows);
      setPages(payload.data.pagination.pages);
      setTotal(payload.data.pagination.total);
      // Always capture global summary counts from the response.
      // These are computed server-side without any filter or search applied,
      // so they represent true system-wide totals regardless of what the user
      // is currently browsing.
      if (payload.data.summary) {
        setTotalActive(payload.data.summary.total_active);
        setTotalRestricted(payload.data.summary.total_restricted);
        setWithSerialId(payload.data.summary.with_serial_id ?? 0);
        setWithoutSerialId(payload.data.summary.without_serial_id ?? 0);
      }
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : "Failed to load bizcards.");
    } finally {
      setLoading(false);
    }
  }, [API, page, search, status]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  /**
   * Metric logic:
   *
   * subscribed — share of claimed bizcards that have a serial_id vs those
   *              without one. Percentage = with_serial / (with + without).
   *
   * active     — global total of active bizcards (no filter/search applied).
   *
   * restricted — global total of restricted bizcards.
   */
  const stats = useMemo(() => {
    const withSerial = withSerialId ?? 0;
    const withoutSerial = withoutSerialId ?? 0;
    const serialTotal = withSerial + withoutSerial;
    const subscribedPct =
      serialTotal === 0 ? 0 : Math.round((withSerial / serialTotal) * 100);
    return {
      subscribedPct,
      subscribedDelta: `${withSerial.toLocaleString()} / ${withoutSerial.toLocaleString()}`,
      active: totalActive ?? 0,
      restricted: totalRestricted ?? 0,
    };
  }, [totalActive, totalRestricted, withSerialId, withoutSerialId]);

  const handleCloseEdit = useCallback(() => {
    if (editSaving) return;
    setEditTarget(null);
    setEditForm(null);
    setEditError(null);
  }, [editSaving]);

  const handleOpenEdit = useCallback(
    async (row: BizcardRow) => {
      setEditTarget(row);
      setEditError(null);
      setEditLoading(true);
      setEditForm(null);
      try {
        const res = await fetch(
          `${API}/api/superadmin/bizcards/${encodeURIComponent(row.bizcard_id)}`,
          { credentials: "include", cache: "no-store" },
        );
        const payload = (await res.json().catch(() => null)) as DetailApiResponse | null;
        if (!res.ok || !payload?.success || !payload.data) {
          throw new Error(extractErrorMessage(payload, "Failed to load bizcard details."));
        }
        const data = payload.data;
        setEditForm({
          subscriptionTier: parseSubscriptionTierValue(data.subscription_tier),
          portfolioUrl: data.portfolio_url ?? "",
          portfolioUrlEditable: data.portfolio_url_editable,
        });
        
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load bizcard details.";
        setEditError(message);
        setEditForm({
          subscriptionTier: parseSubscriptionTierValue(row.subscription_tier),
          portfolioUrl: row.portfolio_url ?? "",
          portfolioUrlEditable: false,

        });
      } finally {
        setEditLoading(false);
      }
    },

    [API],
  );
  const handleSaveEdit = useCallback(async () => {
    if (!editTarget || !editForm) return;
    if (editForm.portfolioUrlEditable && !editForm.portfolioUrl.trim()) {
      setEditError("Portfolio URL is required.");
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      const body: Record<string, string> = {
        subscription_tier: editForm.subscriptionTier,
      };
      if (editForm.portfolioUrlEditable) {
        body.portfolio_url = editForm.portfolioUrl.trim();
      }
      const csrfToken = await fetchCsrfToken(API);
      const res = await fetch(
        `${API}/api/superadmin/bizcards/${encodeURIComponent(editTarget.bizcard_id)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
          },
          body: JSON.stringify(body),
        },
      );
      const payload = (await res.json().catch(() => null)) as DetailApiResponse | null;
      if (!res.ok || !payload?.success || !payload.data) {
        throw new Error(extractErrorMessage(payload, "Failed to update bizcard."));
      }
      const data = payload.data;
      setRows((prev) =>
        prev.map((row) =>
          row.bizcard_id === editTarget.bizcard_id
            ? {
                ...row,
                subscription_tier: data.subscription_tier,
                subscription_plan_name: data.subscription_plan_name,
                subscription_status: data.subscription_status,
                portfolio_url: data.portfolio_url,
                qr_code_url: data.qr_code_url,
              }
            : row,
        ),
      );
      handleCloseEdit();
      pushToast("success", "BizCard updated successfully.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update bizcard.";
      setEditError(message);
      pushToast("error", message);
    } finally {
      setEditSaving(false);
    }
  }, [API, editForm, editTarget, handleCloseEdit, pushToast]);

  const toggleRestricted = useCallback(async () => {
    if (!confirmRow) return;
    setBusyId(confirmRow.bizcard_id);
    try {
      const csrfToken = await fetchCsrfToken(API);
      const res = await fetch(
        `${API}/api/superadmin/bizcards/${encodeURIComponent(confirmRow.bizcard_id)}/restrict`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
          },
          body: JSON.stringify({
            restricted: !confirmRow.restricted,
            reason: confirmRow.restricted ? "Manual reactivation by super admin" : "Restricted by super admin",
          }),
        },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error?.message ?? "Failed to update bizcard.");
      }
      setConfirmRow(null);
      await fetchRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update bizcard.");
    } finally {
      setBusyId(null);
    }
  }, [API, confirmRow, fetchRows]);

  const handleDeleteUser = useCallback(async () => {
    if (!deleteConfirmRow) return;
    setDeleteLoading(true);
    try {
      const csrfToken = await fetchCsrfToken(API);
      const res = await fetch(
        `${API}/api/superadmin/bizcards/${encodeURIComponent(deleteConfirmRow.bizcard_id)}`,
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
          extractErrorMessage(payload, "Failed to delete user. Please try again."),
        );
      }
      // Remove the deleted row from local state immediately — no page refresh needed.
      setRows((prev) => prev.filter((r) => r.bizcard_id !== deleteConfirmRow.bizcard_id));
      setTotal((prev) => Math.max(0, prev - 1));
      // Adjust global summary counts optimistically.
      if (!deleteConfirmRow.restricted) {
        setTotalActive((prev) => (prev !== null ? Math.max(0, prev - 1) : prev));
      } else {
        setTotalRestricted((prev) => (prev !== null ? Math.max(0, prev - 1) : prev));
      }
      setDeleteConfirmRow(null);
      pushToast("success", "User moved to Recycle Bin successfully.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to move user to Recycle Bin. Please try again.";
      pushToast("error", message);
    } finally {
      setDeleteLoading(false);
    }
  }, [API, deleteConfirmRow, pushToast]);

  return (
    <section className="space-y-5 sm:space-y-6">
      <PortalPageHeader
        title="User BizCards"
        subtitle="Browse all claimed bizcards across the platform and manage their availability."
      />

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
        <PortalStatCard
          label="Subscribed Bizcards"
          value={`${stats.subscribedPct}%`}
          delta={stats.subscribedDelta}
          icon={Percent}
          accent={PORTAL_ACCENTS.bizcards}
          loading={loading}
        />
        <PortalStatCard label="Active" value={String(stats.active)} icon={ShieldCheck} accent={PORTAL_ACCENTS.revenue} loading={loading} />
        <PortalStatCard label="Restricted" value={String(stats.restricted)} icon={ShieldBan} accent={PORTAL_ACCENTS.danger} loading={loading} />
      </div>

      <PortalToolbar
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="Search serial ID, name, email, or alias..."
        filters={[
          { id: "all", label: "All", active: status === "all", onClick: () => { setStatus("all"); setPage(1); } },
          { id: "active", label: "Active", active: status === "active", onClick: () => { setStatus("active"); setPage(1); } },
          { id: "restricted", label: "Restricted", active: status === "restricted", onClick: () => { setStatus("restricted"); setPage(1); } },
        ]}
      />

      <PortalMobileCardList>
        {rows.map((row) => (
          <PortalMobileCard key={row.bizcard_id}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-gray-900">{row.name}</p>
                <p className="text-xs text-gray-500">{row.user_email ?? "No email"}</p>
              </div>
              <PortalBadge variant={row.restricted ? "danger" : "success"}>
                {row.restricted ? "Restricted" : "Active"}
              </PortalBadge>
            </div>
            <div className="space-y-1">
              <PortalMobileCardRow label="Serial ID" value={row.serial_id ?? "—"} />
              <PortalMobileCardRow label="Subscription" value={row.subscription_plan_name ?? row.subscription_tier ?? "—"} />
              <PortalMobileCardRow label="Location" value={bizcardLocationLabel(row)} />
              <PortalMobileCardRow
                label="QR"
                value={row.qr_code_url ? <span className="text-primary">Ready</span> : "Missing"}
              />
            </div>
            <div className="mt-4 flex flex-nowrap items-center gap-1.5">
              {row.portfolio_url ? (
                <a
                  href={row.portfolio_url}
                  target="_blank"
                  rel="noreferrer"
                  title="Open portfolio"
                  aria-label="Open portfolio"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-primary hover:bg-gray-50"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => void handleOpenEdit(row)}
                title="Edit"
                aria-label="Edit"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setConfirmRow(row)}
                title={row.restricted ? "Unrestrict" : "Restrict"}
                aria-label={row.restricted ? "Unrestrict" : "Restrict"}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white hover:bg-primary-hover"
              >
                {row.restricted ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldBan className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirmRow(row)}
                title={`Delete user ${row.name}`}
                aria-label={`Delete user ${row.name}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-rose-600 text-white hover:bg-rose-700"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </PortalMobileCard>
        ))}
      </PortalMobileCardList>

      <PortalPanel padding="sm" className="hidden md:block">
        <PortalDataTable
          loading={loading}
          empty={!rows.length}
          emptyTitle="No bizcards found"
          emptyDescription="Try adjusting your search or status filters."
        >
          <PortalTableHead>
            <tr>
              <PortalTableHeaderCell>Serial ID</PortalTableHeaderCell>
              <PortalTableHeaderCell>Name</PortalTableHeaderCell>
              <PortalTableHeaderCell>Subscription</PortalTableHeaderCell>
              <PortalTableHeaderCell>QR Code</PortalTableHeaderCell>
              <PortalTableHeaderCell>Status</PortalTableHeaderCell>
              <PortalTableHeaderCell>Location</PortalTableHeaderCell>
              <PortalTableHeaderCell>Actions</PortalTableHeaderCell>
            </tr>
          </PortalTableHead>
          <PortalTableBody>
            {rows.map((row) => (
              <PortalTableRow key={row.bizcard_id}>
                <PortalTableCell className="font-medium text-gray-900">{row.serial_id ?? "—"}</PortalTableCell>
                <PortalTableCell>
                  <div>
                    <p className="font-semibold text-gray-900">{row.name}</p>
                    <p className="text-xs text-gray-500">{row.user_email ?? "No email"}</p>
                  </div>
                </PortalTableCell>
                <PortalTableCell>
                  <p className="font-medium text-gray-900">{row.subscription_plan_name ?? row.subscription_tier ?? "—"}</p>
                </PortalTableCell>
                <PortalTableCell>
                  {row.qr_code_url ? (
                    <img
                      src={row.qr_code_url}
                      alt={`QR Code ${row.serial_id ?? row.name}`}
                      className="aspect-square h-20 w-20 rounded-lg border border-gray-100 bg-white object-contain p-1"
                    />
                  ) : (
                    <span className="inline-flex items-center gap-1 text-sm text-gray-400">
                      <QrCode className="h-4 w-4" />
                      Missing
                    </span>
                  )}
                </PortalTableCell>
                <PortalTableCell>
                  <PortalBadge variant={row.restricted ? "danger" : "success"}>
                    {row.restricted ? "Restricted" : "Active"}
                  </PortalBadge>
                </PortalTableCell>
                <PortalTableCell>{bizcardLocationLabel(row)}</PortalTableCell>
                <PortalTableCell>
                  <div className="flex flex-nowrap items-center gap-1.5">
                    {row.portfolio_url ? (
                      <a
                        href={row.portfolio_url}
                        target="_blank"
                        rel="noreferrer"
                        title="Open portfolio"
                        aria-label="Open portfolio"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-primary hover:bg-gray-50"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void handleOpenEdit(row)}
                      title="Edit"
                      aria-label="Edit"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRow(row)}
                      title={row.restricted ? "Unrestrict" : "Restrict"}
                      aria-label={row.restricted ? "Unrestrict" : "Restrict"}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white hover:bg-primary-hover"
                    >
                      {row.restricted ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldBan className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmRow(row)}
                      title={`Delete user ${row.name}`}
                      aria-label={`Delete user ${row.name}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-rose-600 text-white hover:bg-rose-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </PortalTableCell>
              </PortalTableRow>
            ))}
          </PortalTableBody>
        </PortalDataTable>
      </PortalPanel>

      <div className="flex items-center justify-between text-sm text-gray-500">
        <p>{total.toLocaleString()} total bizcards</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            className="rounded-lg border border-gray-200 px-3 py-1.5 font-semibold text-gray-700 disabled:opacity-50"
          >
            Previous
          </button>
          <span>Page {page} of {pages}</span>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => setPage((prev) => Math.min(pages, prev + 1))}
            className="rounded-lg border border-gray-200 px-3 py-1.5 font-semibold text-gray-700 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      <PortalModal
        open={Boolean(confirmRow)}
        onClose={() => setConfirmRow(null)}
        title={confirmRow?.restricted ? "Unrestrict Bizcard" : "Restrict Bizcard"}
        description={confirmRow ? `Update access for ${confirmRow.name}.` : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmRow(null)}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void toggleRestricted()}
              disabled={!confirmRow || busyId === confirmRow.bizcard_id}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {busyId === confirmRow?.bizcard_id ? "Saving..." : confirmRow?.restricted ? "Unrestrict" : "Restrict"}
            </button>
          </div>
        }
      >
        <p className="text-sm text-gray-600">
          {confirmRow?.restricted
            ? "This will reactivate the selected bizcard for normal use."
            : "This will deactivate the selected bizcard and mark it as restricted in the registry."}
        </p>
      </PortalModal>

      <PortalModal
        open={Boolean(editTarget)}
        onClose={handleCloseEdit}
        title="Edit BizCard"
        description="Update subscription tier and portfolio URL. Serial ID and QR code cannot be edited directly."
        size="md"
        preventClose={editSaving}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleCloseEdit}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              disabled={editSaving}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSaveEdit()}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
              disabled={editSaving || editLoading || !editForm}
            >
              {editSaving ? (
                <>
                  <InlineLoader />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </button>
          </div>
        }
      >
        {editLoading || !editForm ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
            <InlineLoader />
            Loading bizcard details...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Serial ID
              </label>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700">
                {editTarget?.serial_id ?? "—"}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Status
              </label>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700">
                {editTarget?.restricted ? "Restricted" : "Active"}
              </div>
            </div>
            {editTarget?.user_email ? (
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Associated User
                </label>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                  <div className="font-semibold">{editTarget.name}</div>
                  <div className="text-xs text-slate-500">{editTarget.user_email}</div>
                </div>
              </div>
            ) : null}
            <div className="space-y-2">
              <label htmlFor="editSubscriptionTier" className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Subscription Tier
              </label>
              <select
                id="editSubscriptionTier"
                value={editForm.subscriptionTier}
                onChange={(e) =>
                  setEditForm((prev) =>
                    prev
                      ? {
                          ...prev,
                          subscriptionTier: e.target.value as BizcardSubscriptionTier,
                        }
                      : prev,
                  )
                }
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-800"
                disabled={editSaving}
              >
                {BIZCARD_SUBSCRIPTION_TIERS.map((tier) => (
                  <option key={tier} value={tier}>
                    {formatBizcardSubscriptionTierLabel(tier)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="editPortfolioUrl" className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Portfolio URL
              </label>
              {editForm.portfolioUrlEditable ? (
                <>
                  <input
                    id="editPortfolioUrl"
                    type="url"
                    value={editForm.portfolioUrl}
                    onChange={(e) =>
                      setEditForm((prev) =>
                        prev ? { ...prev, portfolioUrl: e.target.value } : prev,
                      )
                    }
                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-800"
                    disabled={editSaving}
                    placeholder="https://example.com/portfolio"
                  />
                  <p className="text-[11px] text-slate-400">
                    QR code regenerates automatically when the portfolio URL changes.
                  </p>
                </>
              ) : (
                <>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 break-all">
                    {editForm.portfolioUrl || "—"}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Portfolio URL is derived from the user&apos;s URL alias and cannot be edited here.
                  </p>
                </>
              )}
            </div>
            {editError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {editError}
              </div>
            ) : null}
          </div>
        )}
      </PortalModal>

      <PortalModal
        open={Boolean(deleteConfirmRow)}
        onClose={() => {
          if (!deleteLoading) setDeleteConfirmRow(null);
        }}
        title="Move to Recycle Bin"
        description={deleteConfirmRow ? `Move ${deleteConfirmRow.name} to the Recycle Bin?` : undefined}
        preventClose={deleteLoading}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteConfirmRow(null)}
              disabled={deleteLoading}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleDeleteUser()}
              disabled={deleteLoading}
              className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {deleteLoading ? (
                <>
                  <InlineLoader />
                  Moving...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Move to Recycle Bin
                </>
              )}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Are you sure you want to move this user to the Recycle Bin?{" "}
            <span className="font-semibold text-rose-600">You can restore them later from Recycle Bin.</span>
          </p>
          {deleteConfirmRow ? (
            <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-800 space-y-1">
              <p><span className="font-semibold">Name:</span> {deleteConfirmRow.name}</p>
              {deleteConfirmRow.user_email ? (
                <p><span className="font-semibold">Email:</span> {deleteConfirmRow.user_email}</p>
              ) : null}
              {deleteConfirmRow.serial_id ? (
                <p><span className="font-semibold">Serial ID:</span> {deleteConfirmRow.serial_id}</p>
              ) : null}
            </div>
          ) : null}
          <p className="text-xs text-gray-500">
            The user account and BizCard will be deactivated and hidden. Associated data is preserved
            and can be restored from the Recycle Bin. Permanent deletion is only available from Recycle Bin.
          </p>
        </div>
      </PortalModal>

      <PortalToastStack toasts={toasts} onDismiss={dismissToast} />
    </section>
  );
}
