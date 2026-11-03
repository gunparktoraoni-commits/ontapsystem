"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  Mail,
  Phone,
  Search,
  Target,
  TrendingUp,
  UserPlus,
  Users,
  Filter,
} from "lucide-react";
import { PortalPageHeader } from "@/app/superadmin/components/ui/PortalPageHeader";
import { PortalPanel } from "@/app/superadmin/components/ui/PortalPanel";
import { SectionLoader, InlineLoader } from "@/app/components/Loader";
import { showToast } from "@/app/components/Toast";
import { csrfClient } from "@/lib/csrf-client";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import {
  PORTFOLIO_LEAD_STATUSES,
  PORTFOLIO_LEAD_STATUS_LABELS,
  type PortfolioLeadStatus,
} from "@/app/lib/portfolioLeadConstants";

type LeadRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  note: string | null;
  interest: string | null;
  status: string;
  contactedAt: string | null;
  lastContactChannel: string | null;
  ownerNotes: string | null;
  createdAt: string;
  portfolioAlias: string | null;
  portfolioName: string | null;
};

type LeadStats = {
  totalLeads: number;
  newLeads: number;
  contactedLeads: number;
  followUpLeads: number;
  qualifiedLeads: number;
  leadsToday: number;
  leadsThisWeek: number;
  leadsThisMonth: number;
  viewsThisMonth: number;
  conversionRate: number;
  pendingOutreach: number;
};

const API = getFrontendApiBaseUrl();

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "new":
      return "bg-sky-50 text-sky-700 border-sky-200";
    case "contacted":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "follow_up":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "qualified":
      return "bg-violet-50 text-violet-700 border-violet-200";
    case "closed":
      return "bg-gray-100 text-gray-600 border-gray-200";
    case "spam":
      return "bg-rose-50 text-rose-700 border-rose-200";
    default:
      return "bg-gray-50 text-gray-600 border-gray-200";
  }
}

function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return `tel:${digits}`;
}

function mailHref(email: string, name: string): string {
  const subject = encodeURIComponent(`Following up from OnTap`);
  const body = encodeURIComponent(
    `Hi ${name.split(" ")[0] || "there"},\n\nThanks for leaving your details on my OnTap portfolio. I'd love to connect.\n\nBest regards`,
  );
  return `mailto:${email}?subject=${subject}&body=${body}`;
}

export default function LeadsPageClient() {
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<"all" | PortfolioLeadStatus>("all");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const fetchLeads = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: "20",
          status: statusFilter,
        });
        if (debouncedSearch) params.set("search", debouncedSearch);
        const res = await fetch(`${API}/api/leads?${params.toString()}`, {
          credentials: "include",
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || "Failed to load leads.");
        }
        setLeads(Array.isArray(json.data?.leads) ? json.data.leads : []);
        setStats(json.data?.stats ?? null);
        setTotalPages(Math.max(1, Number(json.data?.pagination?.pages ?? 1)));
        setTotal(Number(json.data?.pagination?.total ?? 0));
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Failed to load leads.", "error");
      } finally {
        setLoading(false);
      }
    },
    [debouncedSearch, page, statusFilter],
  );

  useEffect(() => {
    void fetchLeads();
  }, [fetchLeads]);

  const summaryCards = useMemo(() => {
    const s = stats;
    return [
      {
        label: "Total leads",
        value: s?.totalLeads ?? 0,
        hint: "Visitors who shared contact details",
        icon: Users,
        accent: "#2A4792",
      },
      {
        label: "New leads",
        value: s?.newLeads ?? 0,
        hint: `${s?.leadsToday ?? 0} today · ${s?.leadsThisWeek ?? 0} this week`,
        icon: UserPlus,
        accent: "#0EA5E9",
      },
      {
        label: "Conversion rate",
        value: `${s?.conversionRate ?? 0}%`,
        hint: `${s?.leadsThisMonth ?? 0} leads / ${s?.viewsThisMonth ?? 0} views this month`,
        icon: TrendingUp,
        accent: "#10B981",
      },
      {
        label: "Needs outreach",
        value: s?.pendingOutreach ?? 0,
        hint: "New + follow-up leads waiting on you",
        icon: Target,
        accent: "#F59E0B",
      },
    ];
  }, [stats]);

  const updateStatus = async (
    lead: LeadRow,
    status: PortfolioLeadStatus,
    contactChannel?: "call" | "email" | null,
  ) => {
    setUpdatingId(lead.id);
    try {
      const csrf = await csrfClient.getToken(false, API);
      const res = await fetch(`${API}/api/leads/${encodeURIComponent(lead.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        },
        body: JSON.stringify({ status, contactChannel: contactChannel ?? undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Could not update lead.");
      }
      const updated = json.data?.lead as LeadRow;
      setLeads((prev) => prev.map((row) => (row.id === lead.id ? { ...row, ...updated } : row)));
      void fetchLeads({ silent: true });
      showToast(`Marked as ${PORTFOLIO_LEAD_STATUS_LABELS[status]}.`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Update failed.", "error");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleCall = (lead: LeadRow) => {
    window.location.href = telHref(lead.phone);
    if (lead.status === "new") {
      void updateStatus(lead, "contacted", "call");
    }
  };

  const handleEmail = (lead: LeadRow) => {
    window.location.href = mailHref(lead.email, lead.name);
    if (lead.status === "new") {
      void updateStatus(lead, "contacted", "email");
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`${API}/api/leads/export`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || "Export failed.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ontap-leads-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("Leads Excel downloaded.", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Export failed.", "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-w-0 space-y-6">
      <PortalPageHeader
        title="Leads"
        titleClassName="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent"
        subtitle="Capture, prioritize, and follow up with visitors who left their contact details on your portfolio."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={exporting || (stats?.totalLeads ?? 0) === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:hover:bg-primary"
            >
              {exporting ? <InlineLoader /> : <Download className="h-4 w-4" />}
              Download Excel
            </button>
          </div>
        }
      />

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <PortalPanel key={card.label} className="min-w-0 p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {card.label}
                  </p>
                  <p className="mt-1 text-2xl font-extrabold tracking-tight text-gray-900">
                    {card.value}
                  </p>
                  <p className="mt-1 wrap-break-word text-xs text-gray-500">{card.hint}</p>
                </div>
                <span
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: `${card.accent}18`, color: card.accent }}
                >
                  <Icon className="h-5 w-5" />
                </span>
              </div>
            </PortalPanel>
          );
        })}
      </div>

      <PortalPanel className="min-w-0 p-3 sm:p-5">
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full min-w-0 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Search leads by name, email, phone, or note"
              placeholder="Search leads..."
              className="w-full min-w-0 rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-[#4785B8] focus:ring-2 focus:ring-[#4785B8]/20"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
              <Filter className="h-3.5 w-3.5" /> Status
            </span>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as "all" | PortfolioLeadStatus);
                setPage(1);
              }}
              className="max-w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
            >
              <option value="all">All leads</option>
              {PORTFOLIO_LEAD_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {PORTFOLIO_LEAD_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </PortalPanel>

      <PortalPanel className="min-w-0 overflow-hidden p-0">
        {loading ? (
          <div className="p-8">
            <SectionLoader text="Loading your leads…" minHeightClass="min-h-[240px]" />
          </div>
        ) : leads.length === 0 ? (
          <div className="px-4 py-12 text-center sm:px-6 sm:py-16">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#EEF2FA] text-[#2A4792]">
              <UserPlus className="h-7 w-7" />
            </div>
            <h3 className="mt-4 text-lg font-bold text-gray-900">No leads yet</h3>
            <p className="mx-auto mt-2 max-w-md wrap-break-word text-sm text-gray-500">
              When guests leave their name, number, and email on your public portfolio, they&apos;ll
              appear here so you can call or email them quickly.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-gray-100 bg-gray-50/80 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-5 py-3">Lead</th>
                    <th className="px-5 py-3">Contact</th>
                    <th className="px-5 py-3">Interest / note</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Captured</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {leads.map((lead) => (
                    <tr key={lead.id} className="align-top hover:bg-gray-50/60">
                      <td className="px-5 py-4">
                        <p className="font-semibold text-gray-900">{lead.name}</p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {lead.portfolioName || lead.portfolioAlias || "Portfolio"}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-gray-800">{lead.email}</p>
                        <p className="mt-0.5 text-gray-600">{lead.phone}</p>
                      </td>
                      <td className="px-5 py-4">
                        {lead.interest ? (
                          <span className="mb-1 inline-flex rounded-full bg-[#EEF2FA] px-2 py-0.5 text-[11px] font-semibold text-[#2A4792]">
                            {lead.interest}
                          </span>
                        ) : null}
                        <p className="max-w-xs text-xs leading-5 text-gray-500">
                          {lead.note || "No note left"}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <select
                          value={lead.status}
                          disabled={updatingId === lead.id}
                          onChange={(e) =>
                            void updateStatus(lead, e.target.value as PortfolioLeadStatus)
                          }
                          className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${statusBadgeClass(lead.status)}`}
                        >
                          {PORTFOLIO_LEAD_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {PORTFOLIO_LEAD_STATUS_LABELS[status]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-5 py-4 text-xs text-gray-500">
                        {formatDate(lead.createdAt)}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleCall(lead)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                          >
                            <Phone className="h-3.5 w-3.5" /> Call
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEmail(lead)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100"
                          >
                            <Mail className="h-3.5 w-3.5" /> Email
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="min-w-0 divide-y divide-gray-100 md:hidden">
              {leads.map((lead) => (
                <li key={lead.id} className="min-w-0 space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="wrap-break-word font-semibold text-gray-900">{lead.name}</p>
                      <p className="text-xs text-gray-500">{formatDate(lead.createdAt)}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(lead.status)}`}
                    >
                      {PORTFOLIO_LEAD_STATUS_LABELS[lead.status as PortfolioLeadStatus] ??
                        lead.status}
                    </span>
                  </div>
                  <div className="min-w-0 text-sm text-gray-700 wrap-anywhere">
                    <p>{lead.email}</p>
                    <p className="mt-0.5">{lead.phone}</p>
                    {lead.note ? (
                      <p className="mt-2 wrap-break-word text-xs text-gray-500">{lead.note}</p>
                    ) : null}
                  </div>
                  <select
                    value={lead.status}
                    disabled={updatingId === lead.id}
                    onChange={(e) =>
                      void updateStatus(lead, e.target.value as PortfolioLeadStatus)
                    }
                    className="w-full max-w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                  >
                    {PORTFOLIO_LEAD_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {PORTFOLIO_LEAD_STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleCall(lead)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-700"
                    >
                      <Phone className="h-4 w-4" /> Call
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEmail(lead)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm font-semibold text-sky-700"
                    >
                      <Mail className="h-4 w-4" /> Email
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-3 border-t border-gray-100 px-4 py-3 text-sm text-gray-600 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="min-w-0 wrap-break-word">
                Showing page {page} of {totalPages} · {total} lead{total === 1 ? "" : "s"}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 font-semibold disabled:opacity-40"
                >
                  Prev
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 font-semibold disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </PortalPanel>
    </div>
  );
}
