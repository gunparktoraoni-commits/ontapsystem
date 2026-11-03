"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Users, Building2, CreditCard, Activity } from "lucide-react";
import {  InlineLoader, SectionLoader } from "@/app/components/Loader";
import { devApiJson } from "@/app/dev/lib/devApi";

type ClientStatus = "Active" | "Inactive" | "Suspended";
type Plan = "Free" | "Basic" | "Pro" | "Enterprise";

interface Client {
  id: string;
  name: string;
  email: string;
  company: string;
  plan: Plan;
  status: ClientStatus;
  joined: string;
  bizcards: number;
}

function mapPlan(raw: string | null | undefined): Plan {
  const v = String(raw ?? "free").toLowerCase();
  if (v === "enterprise") return "Enterprise";
  if (v === "premium" || v === "pro") return "Pro";
  if (v === "basic" || v === "standard") return "Basic";
  return "Free";
}

function mapStatus(raw: string | null | undefined): ClientStatus {
  const v = String(raw ?? "").toLowerCase();
  if (v === "restricted") return "Suspended";
  if (v === "inactive") return "Inactive";
  return "Active";
}

function planToApi(plan: Plan | "All"): string {
  if (plan === "All") return "all";
  if (plan === "Pro") return "premium";
  return plan.toLowerCase();
}

function statusBadge(status: ClientStatus): string {
  switch (status) {
    case "Active":
      return "bg-green-100 text-green-700";
    case "Inactive":
      return "bg-gray-100  text-gray-500";
    case "Suspended":
      return "bg-red-100   text-red-700";
  }
}

function planBadge(plan: Plan): string {
  switch (plan) {
    case "Free":
      return "bg-gray-100   text-gray-600";
    case "Basic":
      return "bg-blue-100   text-blue-700";
    case "Pro":
      return "bg-purple-100 text-purple-700";
    case "Enterprise":
      return "bg-amber-100  text-amber-700";
  }
}

function formatJoined(value: string | Date | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return "—";
  }
}

export default function ClientsPage() {
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState<Plan | "All">("All");
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState({
    total: 0,
    active: 0,
    suspended: 0,
    enterprise: 0,
  });

  const loadClients = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: "1",
        limit: "200",
        sort_by: "created_at",
        sort_dir: "desc",
        subscription_type: planToApi(planFilter),
      });
      if (search.trim()) params.set("search", search.trim());

      const [listResult, summaryResult] = await Promise.all([
        devApiJson<{
          clients?: Array<Record<string, unknown>>;
          items?: Array<Record<string, unknown>>;
        } | Array<Record<string, unknown>>>(`/api/superadmin/clients?${params.toString()}`, {
          method: "GET",
        }),
        devApiJson<Record<string, unknown>>("/api/superadmin/clients/summary", { method: "GET" }),
      ]);

      if (!listResult.ok) throw new Error(listResult.error ?? "Failed to load clients");
      const listPayload = listResult.data;
      const rows = (
        Array.isArray(listPayload)
          ? listPayload
          : (listPayload?.clients ?? listPayload?.items ?? [])
      ) as Array<Record<string, unknown>>;
      const mapped: Client[] = (Array.isArray(rows) ? rows : []).map((row) => ({
        id: `USR-${String(row.user_id ?? "")}`,
        name: String(row.name ?? "Unknown"),
        email: String(row.email ?? "—"),
        company: "—",
        plan: mapPlan(String(row.subscription_type ?? "free")),
        status: mapStatus(String(row.status ?? "active")),
        joined: formatJoined((row.joined_at ?? row.created_at) as string | Date | null),
        bizcards: Number(row.bizcard_count ?? 0),
      }));
      setClients(mapped);

      if (summaryResult.ok && summaryResult.data) {
        const s = summaryResult.data;
        const subscriptions =
          s.total_subscriptions && typeof s.total_subscriptions === "object"
            ? (s.total_subscriptions as Record<string, unknown>)
            : {};
        setSummary({
          total: Number(s.total_clients ?? mapped.length),
          active: Number(s.total_active ?? mapped.filter((c) => c.status === "Active").length),
          suspended: Number(mapped.filter((c) => c.status === "Suspended").length),
          enterprise: Number(subscriptions.enterprise ?? 0),
        });
      } else {
        setSummary({
          total: mapped.length,
          active: mapped.filter((c) => c.status === "Active").length,
          suspended: mapped.filter((c) => c.status === "Suspended").length,
          enterprise: mapped.filter((c) => c.plan === "Enterprise").length,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load clients");
    } finally {
      setLoading(false);
    }
  }, [planFilter, search]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadClients();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [loadClients]);

  const filtered = useMemo(() => clients, [clients]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Clients", value: summary.total, color: "text-[#2A4792]", icon: Users },
          { label: "Active", value: summary.active, color: "text-green-600", icon: Activity },
          { label: "Suspended", value: summary.suspended, color: "text-red-600", icon: Users },
          { label: "Enterprise", value: summary.enterprise, color: "text-amber-600", icon: Building2 },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-xl px-4 py-3 border border-gray-100 shadow-sm"
          >
            <p className="text-xs text-gray-400 font-medium">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <span
            className="inline-block h-4 w-1 rounded-full shrink-0"
            style={{ background: "linear-gradient(180deg,#2A4792,#4785B8)" }}
          />
          <Users className="h-4 w-4 text-gray-500 shrink-0" />
          <h2 className="text-sm font-semibold text-gray-800 tracking-wide uppercase">
            All Clients
          </h2>
        </div>

        <div className="px-5 py-3 border-b border-gray-50 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by name, email or company…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-4 text-sm text-gray-700 placeholder-gray-400 focus:border-[#2A4792]/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2A4792]/20"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {(["All", "Free", "Basic", "Pro", "Enterprise"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlanFilter(p)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  planFilter === p
                    ? "bg-[#2A4792] text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-xs text-gray-400 font-semibold uppercase tracking-wide border-b border-gray-100 bg-gray-50/50">
                <th className="px-5 py-3 text-left w-24">ID</th>
                <th className="px-5 py-3 text-left">Name</th>
                <th className="px-5 py-3 text-left hidden md:table-cell">Company</th>
                <th className="px-5 py-3 text-left w-20">Plan</th>
                <th className="px-5 py-3 text-left w-16 hidden sm:table-cell">Cards</th>
                <th className="px-5 py-3 text-left w-28 hidden lg:table-cell">Joined</th>
                <th className="px-5 py-3 text-left w-24">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center">
                    <InlineLoader />
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-sm text-red-600">
                    {error}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-sm text-gray-400">
                    No clients match your filters.
                  </td>
                </tr>
              ) : (
                filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-5 py-3 font-mono text-xs text-gray-500">{c.id}</td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-800 truncate max-w-[160px]">{c.name}</p>
                      <p className="text-xs text-gray-400 truncate max-w-[160px]">{c.email}</p>
                    </td>
                    <td className="px-5 py-3 text-gray-500 hidden md:table-cell max-w-[180px] truncate">
                      {c.company}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${planBadge(c.plan)}`}
                      >
                        <CreditCard className="h-3 w-3" />
                        {c.plan}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-center hidden sm:table-cell">
                      {c.bizcards}
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap hidden lg:table-cell">
                      {c.joined}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(c.status)}`}
                      >
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400">
          Showing {filtered.length} clients
        </div>
      </div>
    </div>
  );
}
