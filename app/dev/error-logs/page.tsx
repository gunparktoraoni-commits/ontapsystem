"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Search, AlertTriangle, AlertCircle, Info, ShieldAlert } from "lucide-react";
import {  InlineLoader, SectionLoader } from "@/app/components/Loader";
import { devApiJson } from "@/app/dev/lib/devApi";

type Severity = "Critical" | "High" | "Medium" | "Low";

interface ErrorLog {
  id: string;
  message: string;
  source: string;
  timestamp: string;
  severity: Severity;
}

function severityBadge(severity: Severity): string {
  switch (severity) {
    case "Critical":
      return "bg-red-100    text-red-700";
    case "High":
      return "bg-orange-100 text-orange-700";
    case "Medium":
      return "bg-amber-100  text-amber-700";
    case "Low":
      return "bg-gray-100   text-gray-600";
  }
}

function severityIcon(severity: Severity) {
  switch (severity) {
    case "Critical":
      return <ShieldAlert className="h-3.5 w-3.5 text-red-600" />;
    case "High":
      return <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />;
    case "Medium":
      return <AlertCircle className="h-3.5 w-3.5 text-amber-500" />;
    case "Low":
      return <Info className="h-3.5 w-3.5 text-gray-400" />;
  }
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const SEVERITY_OPTIONS: (Severity | "All")[] = ["All", "Critical", "High", "Medium", "Low"];

export default function ErrorLogsPage() {
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<Severity | "All">("All");
  const [logs, setLogs] = useState<ErrorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState({
    total: 0,
    critical: 0,
    high: 0,
    medium: 0,
  });

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: "1",
        limit: "100",
        severity: severityFilter === "All" ? "all" : severityFilter.toLowerCase(),
      });
      if (search.trim()) params.set("search", search.trim());

      const result = await devApiJson<{
        items?: ErrorLog[];
        summary?: { total?: number; critical?: number; high?: number; medium?: number };
      }>(`/api/dev/error-logs?${params.toString()}`, { method: "GET" });
      if (!result.ok) throw new Error(result.error ?? "Failed to load error logs");
      const items = (result.data?.items ?? []) as ErrorLog[];
      setLogs(items);
      const s = result.data?.summary ?? {};
      setSummary({
        total: Number(s.total ?? items.length),
        critical: Number(s.critical ?? 0),
        high: Number(s.high ?? 0),
        medium: Number(s.medium ?? 0),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load error logs");
    } finally {
      setLoading(false);
    }
  }, [search, severityFilter]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadLogs();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [loadLogs]);

  const filtered = useMemo(() => logs, [logs]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Errors", value: summary.total, color: "text-[#2A4792]" },
          { label: "Critical", value: summary.critical, color: "text-red-600" },
          { label: "High", value: summary.high, color: "text-orange-600" },
          { label: "Medium", value: summary.medium, color: "text-amber-600" },
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
          <AlertTriangle className="h-4 w-4 text-gray-500 shrink-0" />
          <h2 className="text-sm font-semibold text-gray-800 tracking-wide uppercase">
            System Error Logs
          </h2>
        </div>

        <div className="px-5 py-3 border-b border-gray-50 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by ID, message or source…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-4 text-sm text-gray-700 placeholder-gray-400 focus:border-[#2A4792]/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2A4792]/20"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {SEVERITY_OPTIONS.map((sv) => (
              <button
                key={sv}
                type="button"
                onClick={() => setSeverityFilter(sv)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  severityFilter === sv
                    ? "bg-[#2A4792] text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {sv}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-xs text-gray-400 font-semibold uppercase tracking-wide border-b border-gray-100 bg-gray-50/50">
                <th className="px-5 py-3 text-left w-24">ID</th>
                <th className="px-5 py-3 text-left">Message</th>
                <th className="px-5 py-3 text-left hidden md:table-cell">Source</th>
                <th className="px-5 py-3 text-left w-36 hidden sm:table-cell">Timestamp</th>
                <th className="px-5 py-3 text-left w-24">Severity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center">
                    <InlineLoader />
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-sm text-red-600">
                    {error}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">
                    No error logs match your filters.
                  </td>
                </tr>
              ) : (
                filtered.map((e) => (
                  <tr
                    key={e.id}
                    className={`transition-colors ${
                      e.severity === "Critical" || e.severity === "High"
                        ? "bg-red-50/20 hover:bg-red-50/40"
                        : "hover:bg-gray-50/60"
                    }`}
                  >
                    <td className="px-5 py-3 font-mono text-xs text-gray-500">{e.id}</td>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-1.5 text-gray-700">
                        {severityIcon(e.severity)}
                        <span className="truncate max-w-[240px]">{e.message}</span>
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-400 hidden md:table-cell max-w-[180px] truncate">
                      {e.source}
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap hidden sm:table-cell">
                      {formatTimestamp(e.timestamp)}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${severityBadge(e.severity)}`}
                      >
                        {e.severity}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400">
          Showing {filtered.length} of {summary.total} errors
        </div>
      </div>
    </div>
  );
}
