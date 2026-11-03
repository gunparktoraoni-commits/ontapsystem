"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Ban, RefreshCw } from "lucide-react";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import {
  PORTAL_ACCENTS,
  PortalBadge,
  PortalDataTable,
  PortalPanel,
  PortalPageHeader,
  PortalStatCard,
  PortalTableBody,
  PortalTableCell,
  PortalTableHead,
  PortalTableHeaderCell,
  PortalTableRow,
  PortalToolbar,
} from "./ui";

type TxType = "all" | "renewal" | "upgrade" | "downgrade" | "cancellation";

type TxRow = {
  transaction_id: string;
  type: Exclude<TxType, "all">;
  user_id: string | null;
  user_email: string | null;
  bizcard_id: string;
  bizcard_serial: string | null;
  from_plan: string | null;
  to_plan: string | null;
  amount: number;
  status: string;
  effective_date: string;
  created_at: string;
  order_number: string | null;
};

type TxCounts = {
  renewal: number;
  upgrade: number;
  downgrade: number;
  cancellation: number;
};

export default function SubscriptionTransactionsPanel() {
  const API = getFrontendApiBaseUrl();
  const [rows, setRows] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<TxType>("all");
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<TxCounts>({
    renewal: 0,
    upgrade: 0,
    downgrade: 0,
    cancellation: 0,
  });

  const setTypeFilter = useCallback((next: TxType) => {
    setType((prev) => (prev === next ? "all" : next));
    setPage(1);
  }, []);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "20",
        type,
      });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`${API}/api/superadmin/subscription-transactions?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success || !payload?.data) {
        throw new Error(payload?.error?.message ?? "Failed to load transactions.");
      }
      setRows(payload.data.rows);
      setPages(payload.data.pagination.pages);
      setTotal(payload.data.pagination.total);
      if (payload.data.counts) {
        setCounts({
          renewal: Number(payload.data.counts.renewal ?? 0),
          upgrade: Number(payload.data.counts.upgrade ?? 0),
          downgrade: Number(payload.data.counts.downgrade ?? 0),
          cancellation: Number(payload.data.counts.cancellation ?? 0),
        });
      }
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : "Failed to load transactions.");
    } finally {
      setLoading(false);
    }
  }, [API, page, search, type]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const badgeVariant = (rowType: TxRow["type"]) => {
    switch (rowType) {
      case "renewal":
        return "success";
      case "upgrade":
        return "info";
      case "downgrade":
        return "warning";
      case "cancellation":
        return "danger";
    }
  };

  return (
    <section className="space-y-5 sm:space-y-6">
      <PortalPageHeader
        title="Subscription Transactions"
        subtitle="Review renewal, upgrade, downgrade, and cancellation events across all users."
        actions={
          <button
            type="button"
            onClick={() => void fetchRows()}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-primary hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        }
      />

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 sm:gap-5">
        <PortalStatCard
          label="Renewals"
          value={String(counts.renewal)}
          icon={RefreshCw}
          accent={PORTAL_ACCENTS.revenue}
          loading={loading}
          active={type === "renewal"}
          hint="Show renewed subscriptions"
          onClick={() => setTypeFilter("renewal")}
        />
        <PortalStatCard
          label="Upgrades"
          value={String(counts.upgrade)}
          icon={ArrowUpRight}
          accent={PORTAL_ACCENTS.orders}
          loading={loading}
          active={type === "upgrade"}
          hint="Show upgrades"
          onClick={() => setTypeFilter("upgrade")}
        />
        <PortalStatCard
          label="Downgrades"
          value={String(counts.downgrade)}
          icon={ArrowDownRight}
          accent={PORTAL_ACCENTS.warning}
          loading={loading}
          active={type === "downgrade"}
          hint="Show downgrades"
          onClick={() => setTypeFilter("downgrade")}
        />
        <PortalStatCard
          label="Cancellations"
          value={String(counts.cancellation)}
          icon={Ban}
          accent={PORTAL_ACCENTS.danger}
          loading={loading}
          active={type === "cancellation"}
          hint="Show cancellations"
          onClick={() => setTypeFilter("cancellation")}
        />
      </div>

      <PortalToolbar
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="Search user, serial ID, plan, or order..."
        filters={[
          { id: "all", label: "All", active: type === "all", onClick: () => { setType("all"); setPage(1); } },
          { id: "renewal", label: "Renewals", active: type === "renewal", onClick: () => { setType("renewal"); setPage(1); } },
          { id: "upgrade", label: "Upgrades", active: type === "upgrade", onClick: () => { setType("upgrade"); setPage(1); } },
          { id: "downgrade", label: "Downgrades", active: type === "downgrade", onClick: () => { setType("downgrade"); setPage(1); } },
          { id: "cancellation", label: "Cancellations", active: type === "cancellation", onClick: () => { setType("cancellation"); setPage(1); } },
        ]}
      />

      <PortalPanel padding="sm">
        <PortalDataTable
          loading={loading}
          empty={!rows.length}
          emptyTitle="No transactions found"
          emptyDescription="Try adjusting your filters."
        >
          <PortalTableHead>
            <tr>
              <PortalTableHeaderCell>Type</PortalTableHeaderCell>
              <PortalTableHeaderCell>User</PortalTableHeaderCell>
              <PortalTableHeaderCell>BizCard</PortalTableHeaderCell>
              <PortalTableHeaderCell>Plans</PortalTableHeaderCell>
              <PortalTableHeaderCell>Amount</PortalTableHeaderCell>
              <PortalTableHeaderCell>Status</PortalTableHeaderCell>
              <PortalTableHeaderCell>Created</PortalTableHeaderCell>
            </tr>
          </PortalTableHead>
          <PortalTableBody>
            {rows.map((row) => (
              <PortalTableRow key={row.transaction_id}>
                <PortalTableCell>
                  <PortalBadge variant={badgeVariant(row.type)}>{row.type}</PortalBadge>
                </PortalTableCell>
                <PortalTableCell>
                  <div>
                    <p className="font-semibold text-gray-900">{row.user_email ?? "Unknown user"}</p>
                    <p className="text-xs text-gray-500">User ID: {row.user_id ?? "—"}</p>
                  </div>
                </PortalTableCell>
                <PortalTableCell>
                  <div>
                    <p className="font-semibold text-gray-900">{row.bizcard_serial ?? "—"}</p>
                    <p className="text-xs text-gray-500">BizCard ID: {row.bizcard_id}</p>
                  </div>
                </PortalTableCell>
                <PortalTableCell>
                  <div className="text-sm">
                    <p className="font-medium text-gray-900">{row.to_plan ?? "—"}</p>
                    <p className="text-xs text-gray-500">
                      {row.from_plan ? `From ${row.from_plan}` : row.type === "renewal" ? "Renewal" : "—"}
                    </p>
                  </div>
                </PortalTableCell>
                <PortalTableCell className="font-semibold text-gray-900">
                  {new Intl.NumberFormat("en-US", { style: "currency", currency: "PHP" }).format(row.amount)}
                </PortalTableCell>
                <PortalTableCell>
                  <PortalBadge variant={row.status === "completed" ? "success" : row.status === "cancelled" ? "danger" : "warning"}>
                    {row.status}
                  </PortalBadge>
                </PortalTableCell>
                <PortalTableCell className="text-sm text-gray-600">
                  {new Date(row.created_at).toLocaleString()}
                </PortalTableCell>
              </PortalTableRow>
            ))}
          </PortalTableBody>
        </PortalDataTable>

        <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4">
          <p className="text-sm text-gray-500">
            {total} transaction{total === 1 ? "" : "s"}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-sm text-gray-500">
              Page {page} of {pages}
            </span>
            <button
              type="button"
              disabled={page >= pages || loading}
              onClick={() => setPage((prev) => Math.min(pages, prev + 1))}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </PortalPanel>
    </section>
  );
}
