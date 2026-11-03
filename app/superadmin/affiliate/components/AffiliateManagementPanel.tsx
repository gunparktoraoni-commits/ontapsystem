"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Download,
  ExternalLink,
  Pencil,
  Users,
  Wallet,
} from "lucide-react";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { toServableMediaSrc } from "@/app/lib/portfolioDisplay";
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
  PortalToolbar,
} from "../../components/ui";
import AffiliateDetailModal from "./AffiliateDetailModal";

function resolveAffiliateAvatar(raw: string | null | undefined): string | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;
  return toServableMediaSrc(value) || null;
}

function AffiliateAvatar({
  name,
  imageUrl,
  className = "h-9 w-9 rounded-xl text-xs",
}: {
  name: string;
  imageUrl?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden border border-gray-200 bg-primary/10 font-bold text-primary ${className}`}
    >
      {imageUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={name}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        initials || "A"
      )}
    </div>
  );
}

type AffiliateRow = {
  affiliate_id: number;
  name: string;
  email: string;
  affiliate_code: string | null;
  commission_rate: number;
  successful_referrals: number;
  total_referrals: number;
  total_earnings: number;
  status: "active" | "restricted";
  profile_image: string | null;
  serial_id: string | null;
  subscription: string;
  portfolio_url: string | null;
  tags: string[];
};

type SummaryPayload = {
  total_referral_count: number;
  conversion_rate: number;
  total_paidout: number;
  total_paid: number;
  pending_payout: number;
  active_affiliates: number;
};

type SortField =
  | "affiliate_name"
  | "affiliate_code"
  | "commission_rate"
  | "successful_referrals"
  | "total_earnings";

type SortDirection = "asc" | "desc";

const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "PHP" }).format(value);

function tagVariant(tag: string): "success" | "warning" | "danger" | "info" | "primary" {
  if (tag.includes("Needs Attention")) return "danger";
  if (tag.includes("Rising")) return "info";
  if (tag.includes("Biggest") || tag.includes("High Earner")) return "success";
  if (tag.includes("Top Referrer")) return "primary";
  return "warning";
}

function mapSortField(field: SortField): string {
  if (field === "affiliate_name") return "joined_at";
  if (field === "successful_referrals") return "successful_referrals";
  if (field === "total_earnings") return "total_earnings";
  if (field === "commission_rate") return "joined_at";
  return "joined_at";
}

export default function AffiliateManagementPanel() {
  const API = getFrontendApiBaseUrl();
  const [rows, setRows] = useState<AffiliateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<SummaryPayload>({
    total_referral_count: 0,
    conversion_rate: 0,
    total_paidout: 0,
    total_paid: 0,
    pending_payout: 0,
    active_affiliates: 0,
  });
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "restricted">("all");
  const [error, setError] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<AffiliateRow | null>(null);
  const [editRate, setEditRate] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("successful_referrals");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [detailAffiliateId, setDetailAffiliateId] = useState<number | null>(null);

  const fetchSummary = useCallback(async () => {
    const res = await fetch(`${API}/api/superadmin/affiliates/summary`, {
      credentials: "include",
      cache: "no-store",
    });
    const payload = await res.json().catch(() => null);
    if (res.ok && payload?.success && payload?.data) {
      setSummary({
        total_referral_count: Number(payload.data.total_referral_count ?? 0),
        conversion_rate: Number(payload.data.conversion_rate ?? 0),
        total_paidout: Number(payload.data.total_paidout ?? 0),
        total_paid: Number(payload.data.total_paid ?? 0),
        pending_payout: Number(payload.data.pending_payout ?? 0),
        active_affiliates: Number(payload.data.active_affiliates ?? 0),
      });
    }
  }, [API]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "20",
        status,
        sort_by: mapSortField(sortField),
        sort_dir: sortDirection,
      });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`${API}/api/superadmin/affiliates?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success || !payload?.data) {
        throw new Error(payload?.error?.message ?? "Failed to load affiliates.");
      }

      const affiliates = (payload.data.affiliates ?? []).map((item: Record<string, unknown>) => ({
        affiliate_id: Number(item.affiliate_id ?? item.user_id ?? 0),
        name: String(item.name ?? "Unknown"),
        email: String(item.email ?? ""),
        affiliate_code: (item.affiliate_code as string | null) ?? null,
        commission_rate: Number(item.commission_rate ?? 5),
        successful_referrals: Number(item.successful_referrals ?? 0),
        total_referrals: Number(item.total_referrals ?? 0),
        total_earnings: Number(item.total_earnings ?? item.commission_received ?? 0),
        status: item.is_restricted || item.status === "restricted" ? "restricted" : "active",
        profile_image: resolveAffiliateAvatar((item.profile_image as string | null) ?? null),
        serial_id: (item.serial_id as string | null) ?? null,
        subscription: String(item.subscription ?? "free"),
        portfolio_url: (item.portfolio_url as string | null) ?? null,
        tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
      })) as AffiliateRow[];

      // Client-side sort for columns not fully supported by API
      const sorted = [...affiliates];
      if (sortField === "affiliate_name") {
        sorted.sort((a, b) =>
          sortDirection === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name),
        );
      } else if (sortField === "affiliate_code") {
        sorted.sort((a, b) => {
          const left = a.affiliate_code ?? "";
          const right = b.affiliate_code ?? "";
          return sortDirection === "asc" ? left.localeCompare(right) : right.localeCompare(left);
        });
      } else if (sortField === "commission_rate") {
        sorted.sort((a, b) =>
          sortDirection === "asc"
            ? a.commission_rate - b.commission_rate
            : b.commission_rate - a.commission_rate,
        );
      }

      setRows(sorted);
      setPages(payload.data.pagination.pages);
      setTotal(payload.data.pagination.total);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : "Failed to load affiliates.");
    } finally {
      setLoading(false);
    }
  }, [API, page, search, status, sortField, sortDirection]);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const stats = useMemo(
    () => [
      {
        label: "Total Referrals",
        value: String(summary.total_referral_count),
        icon: Users,
        accent: PORTAL_ACCENTS.affiliates,
      },
      {
        label: "Active Affiliates",
        value: String(summary.active_affiliates),
        icon: Users,
        accent: PORTAL_ACCENTS.orders,
      },
      {
        label: "Total Paid Out",
        value: money(summary.total_paidout),
        icon: Wallet,
        accent: PORTAL_ACCENTS.revenue,
      },
      {
        label: "Pending Payout",
        value: money(summary.pending_payout),
        icon: Wallet,
        accent: PORTAL_ACCENTS.warning,
      },
    ],
    [summary],
  );

  const openEdit = (row: AffiliateRow, event?: React.MouseEvent) => {
    event?.stopPropagation();
    setEditingRow(row);
    setEditRate(String(row.commission_rate));
  };

  const openPortfolio = (row: AffiliateRow, event?: React.MouseEvent) => {
    event?.stopPropagation();
    if (!row.portfolio_url) return;
    window.open(row.portfolio_url, "_blank", "noopener,noreferrer");
  };

  const saveRate = useCallback(async () => {
    if (!editingRow) return;
    setBusyKey(`edit:${editingRow.affiliate_id}`);
    try {
      const res = await fetch(
        `${API}/api/superadmin/affiliates/${encodeURIComponent(String(editingRow.affiliate_id))}/commission-rate`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commission_rate: Number(editRate) }),
        },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error?.message ?? "Failed to update commission rate.");
      }
      setEditingRow(null);
      await fetchRows();
      await fetchSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update commission rate.");
    } finally {
      setBusyKey(null);
    }
  }, [API, editRate, editingRow, fetchRows, fetchSummary]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection(field === "affiliate_name" || field === "affiliate_code" ? "asc" : "desc");
    }
    setPage(1);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronsUpDown className="h-3.5 w-3.5 text-gray-400" />;
    return sortDirection === "asc" ? (
      <ChevronUp className="h-3.5 w-3.5 text-primary" />
    ) : (
      <ChevronDown className="h-3.5 w-3.5 text-primary" />
    );
  };

  const renderNameCell = (row: AffiliateRow) => {
    return (
      <div className="flex min-w-0 items-start gap-3">
        <AffiliateAvatar name={row.name} imageUrl={row.profile_image} />
        <div className="min-w-0">
          <p className="truncate font-semibold text-gray-900">{row.name}</p>
          <p className="truncate text-xs text-gray-500">{row.email}</p>
          {row.tags.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {row.tags.slice(0, 2).map((tag) => (
                <PortalBadge key={tag} variant={tagVariant(tag)} className="normal-case tracking-normal">
                  {tag}
                </PortalBadge>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const renderActions = (row: AffiliateRow) => (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        title="Edit commission rate"
        aria-label="Edit commission rate"
        onClick={(event) => openEdit(row, event)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-primary hover:bg-gray-50"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        title={row.portfolio_url ? "Open portfolio" : "Portfolio unavailable"}
        aria-label="Open portfolio"
        disabled={!row.portfolio_url}
        onClick={(event) => openPortfolio(row, event)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-primary hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ExternalLink className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <section className="space-y-5 sm:space-y-6">
      <PortalPageHeader
        title="Affiliates"
        subtitle="Monitor affiliate performance, referral orders, commissions, and withdrawals. Default commission is 5%."
        actions={
          <a
            href={`${API}/api/superadmin/affiliates/export`}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-primary hover:bg-gray-50"
          >
            <Download className="h-4 w-4" />
            Export Affiliates
          </a>
        }
      />

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 sm:gap-5">
        {stats.map((card) => (
          <PortalStatCard
            key={card.label}
            label={card.label}
            value={card.value}
            icon={card.icon}
            accent={card.accent}
            loading={loading}
          />
        ))}
      </div>

      <PortalToolbar
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="Search name, email, affiliate code, or serial ID..."
        filters={[
          {
            id: "all",
            label: "All",
            active: status === "all",
            onClick: () => {
              setStatus("all");
              setPage(1);
            },
          },
          {
            id: "active",
            label: "Active",
            active: status === "active",
            onClick: () => {
              setStatus("active");
              setPage(1);
            },
          },
          {
            id: "restricted",
            label: "Restricted",
            active: status === "restricted",
            onClick: () => {
              setStatus("restricted");
              setPage(1);
            },
          },
        ]}
      />

      <PortalMobileCardList>
        {rows.map((row) => (
          <PortalMobileCard
            key={row.affiliate_id}
            className="cursor-pointer transition hover:border-primary/30"
            onClick={() => setDetailAffiliateId(row.affiliate_id)}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              {renderNameCell(row)}
              {renderActions(row)}
            </div>
            <div className="space-y-1">
              <PortalMobileCardRow label="Affiliate code" value={row.affiliate_code ?? "—"} />
              <PortalMobileCardRow label="Percentage" value={`${row.commission_rate}%`} />
              <PortalMobileCardRow label="Successful referrals" value={String(row.successful_referrals)} />
              <PortalMobileCardRow label="Earnings" value={money(row.total_earnings)} />
            </div>
          </PortalMobileCard>
        ))}
      </PortalMobileCardList>

      <PortalPanel padding="sm" className="hidden md:block">
        <PortalDataTable
          loading={loading}
          empty={!rows.length}
          emptyTitle="No affiliates found"
          emptyDescription="Affiliates will appear here once users match the current filters."
        >
          <PortalTableHead>
            <tr>
              <PortalTableHeaderCell>
                <button
                  type="button"
                  onClick={() => toggleSort("affiliate_name")}
                  className="inline-flex items-center gap-1.5 font-medium transition-colors hover:text-primary"
                >
                  Affiliate Name
                  <SortIcon field="affiliate_name" />
                </button>
              </PortalTableHeaderCell>
              <PortalTableHeaderCell>
                <button
                  type="button"
                  onClick={() => toggleSort("affiliate_code")}
                  className="inline-flex items-center gap-1.5 font-medium transition-colors hover:text-primary"
                >
                  Affiliate Code
                  <SortIcon field="affiliate_code" />
                </button>
              </PortalTableHeaderCell>
              <PortalTableHeaderCell>
                <button
                  type="button"
                  onClick={() => toggleSort("commission_rate")}
                  className="inline-flex items-center gap-1.5 font-medium transition-colors hover:text-primary"
                >
                  Percentage
                  <SortIcon field="commission_rate" />
                </button>
              </PortalTableHeaderCell>
              <PortalTableHeaderCell>
                <button
                  type="button"
                  onClick={() => toggleSort("successful_referrals")}
                  className="inline-flex items-center gap-1.5 font-medium transition-colors hover:text-primary"
                >
                  Successful Referrals
                  <SortIcon field="successful_referrals" />
                </button>
              </PortalTableHeaderCell>
              <PortalTableHeaderCell>
                <button
                  type="button"
                  onClick={() => toggleSort("total_earnings")}
                  className="inline-flex items-center gap-1.5 font-medium transition-colors hover:text-primary"
                >
                  Earnings
                  <SortIcon field="total_earnings" />
                </button>
              </PortalTableHeaderCell>
              <PortalTableHeaderCell>Actions</PortalTableHeaderCell>
            </tr>
          </PortalTableHead>
          <PortalTableBody>
            {rows.map((row) => (
              <PortalTableRow
                key={row.affiliate_id}
                className="cursor-pointer transition hover:bg-slate-50/80"
                onClick={() => setDetailAffiliateId(row.affiliate_id)}
              >
                <PortalTableCell>{renderNameCell(row)}</PortalTableCell>
                <PortalTableCell>{row.affiliate_code ?? "—"}</PortalTableCell>
                <PortalTableCell>{row.commission_rate}%</PortalTableCell>
                <PortalTableCell className="font-semibold text-gray-900">
                  {row.successful_referrals.toLocaleString()}
                </PortalTableCell>
                <PortalTableCell className="font-semibold text-gray-900">
                  {money(row.total_earnings)}
                </PortalTableCell>
                <PortalTableCell>
                  <div onClick={(event) => event.stopPropagation()}>{renderActions(row)}</div>
                </PortalTableCell>
              </PortalTableRow>
            ))}
          </PortalTableBody>
        </PortalDataTable>
      </PortalPanel>

      <div className="flex items-center justify-between text-sm text-gray-500">
        <p>{total.toLocaleString()} total affiliates</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            className="rounded-lg border border-gray-200 px-3 py-1.5 font-semibold text-gray-700 disabled:opacity-50"
          >
            Previous
          </button>
          <span>
            Page {page} of {pages}
          </span>
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
        open={Boolean(editingRow)}
        onClose={() => setEditingRow(null)}
        title="Edit Commission Percentage"
        description={
          editingRow
            ? `Update the commission percentage for ${editingRow.name}.`
            : undefined
        }
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditingRow(null)}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveRate()}
              disabled={!editingRow || busyKey === `edit:${editingRow.affiliate_id}`}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {editingRow && busyKey === `edit:${editingRow.affiliate_id}` ? "Saving..." : "Save"}
            </button>
          </div>
        }
      >
        <label className="block text-sm font-semibold text-gray-700">
          Percentage
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={editRate}
            onChange={(e) => setEditRate(e.target.value)}
            className="mt-2 h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
      </PortalModal>

      <AffiliateDetailModal
        open={detailAffiliateId != null}
        affiliateId={detailAffiliateId}
        onClose={() => setDetailAffiliateId(null)}
      />
    </section>
  );
}
