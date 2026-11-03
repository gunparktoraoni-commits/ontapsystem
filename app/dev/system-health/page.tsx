"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { InlineLoader, SectionLoader } from "@/app/components/Loader";
import { DevCard } from "@/app/dev/components/DevCard";
import { DevKpiStrip } from "@/app/dev/components/DevKpiStrip";
import { devApiJson } from "@/app/dev/lib/devApi";
import {
  AlertTriangle,
  BellRing,
  ChevronRight,
  Database,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Siren,
  TimerReset,
} from "lucide-react";

type HealthStatus = "ok" | "warning" | "error";
type SummaryLevel = "healthy" | "warning" | "critical";
type DatePreset = "today" | "week" | "month" | "custom";

type SystemHealthData = {
  range: { preset: DatePreset; from: string; to: string; label: string };
  summary: {
    overallStatus: SummaryLevel;
    databaseStatus: SummaryLevel;
    securityStatus: SummaryLevel;
    openAlerts: number;
    criticalAlerts: number;
    mainDbLatencyMs: number;
    analyticsDbLatencyMs: number;
  };
  database: {
    overallStatus: SummaryLevel;
    services: Array<{
      key: string;
      label: string;
      status: HealthStatus;
      latencyMs: number;
      detail: string;
    }>;
    findings: Array<{
      key: string;
      label: string;
      status: HealthStatus;
      value: string | number;
      detail: string;
      actionUrl?: string;
    }>;
    recentErrors: Array<{
      id: string;
      severity: string;
      message: string;
      source: string;
      createdAt: string;
    }>;
  };
  security: {
    overallStatus: SummaryLevel;
    failedLogins: number;
    uniqueFailedLoginIps: number;
    failedLogins24h?: number;
    uniqueFailedLoginIps24h?: number;
    devSessions: number;
    superAdminSessions: number;
    findings: Array<{
      key: string;
      label: string;
      status: HealthStatus;
      value: string | number;
      detail: string;
      actionUrl?: string;
    }>;
  };
  alerts: Array<{
    id: string;
    type: string;
    severity: "info" | "warning" | "critical";
    title: string;
    message: string;
    createdAt: string;
    source: "security_alerts" | "audit_log";
    actionUrl?: string;
  }>;
  recommendations: string[];
};

const PRESETS: Array<{ id: DatePreset; label: string }> = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "custom", label: "Custom" },
];

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function toDateInputValue(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function valueTone(status: HealthStatus) {
  if (status === "error") return "text-red-700";
  if (status === "warning") return "text-amber-700";
  return "text-gray-900";
}

function severityClasses(severity: "info" | "warning" | "critical") {
  if (severity === "critical") return "bg-red-50 text-red-700 border-red-200";
  if (severity === "warning") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-blue-50 text-blue-700 border-blue-200";
}

export default function DevSystemHealthPage() {
  const router = useRouter();
  const [preset, setPreset] = useState<DatePreset>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<SystemHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const queryPath = useMemo(() => {
    const params = new URLSearchParams();
    params.set("range", preset);
    if (preset === "custom") {
      if (customFrom) params.set("from", customFrom);
      if (customTo) params.set("to", customTo);
    }
    return `/api/dev/system-health?${params.toString()}`;
  }, [preset, customFrom, customTo]);

  async function load() {
    if (preset === "custom" && (!customFrom || !customTo)) {
      setError("Choose both start and end dates for a custom range.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const result = await devApiJson<SystemHealthData>(queryPath, { method: "GET" });
    if (!result.ok || !result.data) {
      setError(result.error ?? "Failed to load system health.");
      setData(null);
      setLoading(false);
      return;
    }
    const payload = result.data;
    setData(payload);
    if (!customFrom && payload.range.from) {
      setCustomFrom(toDateInputValue(payload.range.from));
    }
    if (!customTo && payload.range.to) {
      setCustomTo(toDateInputValue(payload.range.to));
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryPath]);

  if (loading && !data) {
    return (
      <SectionLoader text="Loading..." />
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl bg-white p-6 text-sm text-red-600 shadow-sm">
        {error ?? "Failed to load system health."}
      </div>
    );
  }

  const failedLogins = data.security.failedLogins ?? data.security.failedLogins24h ?? 0;
  const uniqueIps =
    data.security.uniqueFailedLoginIps ?? data.security.uniqueFailedLoginIps24h ?? 0;

  const overallIcon =
    data.summary.overallStatus === "critical" ? (
      <Siren className="h-5 w-5 text-red-600" />
    ) : data.summary.overallStatus === "warning" ? (
      <AlertTriangle className="h-5 w-5 text-amber-600" />
    ) : (
      <ShieldCheck className="h-5 w-5 text-emerald-600" />
    );

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#EEF2FA]">
              {overallIcon}
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">System Health Center</h2>
              <p className="mt-1 text-sm text-gray-500">
                Metrics for <span className="font-medium text-gray-700">{data.range.label}</span>
                {" · "}
                DB latency, security posture, and alerts update with the date filter.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50"
          >
            <TimerReset className="h-4 w-4" />
            Refresh Health
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-4">
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setPreset(item.id)}
              className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                preset === item.id
                  ? "bg-[#2A4792] text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {item.label}
            </button>
          ))}
          {preset === "custom" ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
                className="rounded-xl border border-slate-200 px-2.5 py-2 text-xs"
              />
              <span className="text-xs text-slate-400">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
                className="rounded-xl border border-slate-200 px-2.5 py-2 text-xs"
              />
            </div>
          ) : null}
        </div>
        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : null}
      </div>

      <DevKpiStrip
        items={[
          {
            label: "Main DB latency",
            value: `${data.summary.mainDbLatencyMs} ms`,
            tone: data.summary.mainDbLatencyMs > 300 ? "warning" : "success",
          },
          {
            label: "Open alerts",
            value: data.summary.openAlerts,
            tone: data.summary.openAlerts > 0 ? "warning" : "success",
          },
          {
            label: "Critical alerts",
            value: data.summary.criticalAlerts,
            tone: data.summary.criticalAlerts > 0 ? "danger" : "success",
          },
          {
            label: `Failed logins (${data.range.label})`,
            value: failedLogins,
            tone: failedLogins > 10 ? "warning" : "default",
          },
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <DevCard
          title="Database Health"
          subtitle={`Reachability is live. Error counts cover ${data.range.label}.`}
          actions={
            <span className="text-xs font-semibold text-gray-500">
              Analytics {data.summary.analyticsDbLatencyMs} ms
            </span>
          }
        >
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {data.database.services.map((service) => (
                <div key={service.key} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{service.label}</p>
                      <p className="mt-1 text-xs text-gray-500">{service.detail}</p>
                    </div>
                    <Database className="h-4 w-4 text-gray-400" />
                  </div>
                  <p className={`mt-3 text-2xl font-bold ${valueTone(service.status)}`}>
                    {service.latencyMs} ms
                  </p>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              {data.database.findings.map((item) => (
                <div key={item.key} className="rounded-xl border border-gray-100 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{item.label}</p>
                      <p className="mt-1 text-sm text-gray-600">{item.detail}</p>
                    </div>
                    <p className={`text-lg font-bold tabular-nums ${valueTone(item.status)}`}>
                      {item.value}
                    </p>
                  </div>
                  {item.actionUrl ? (
                    <div className="mt-2">
                      <Link href={item.actionUrl} className="text-xs font-semibold text-[#2A4792] hover:underline">
                        Investigate
                      </Link>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </DevCard>

        <DevCard
          title="System Security Health"
          subtitle={`Login pressure for ${data.range.label}. Privileged sessions are live.`}
          actions={
            <span className="text-xs font-semibold text-gray-500">
              {uniqueIps} unique IPs
            </span>
          }
        >
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-900">Failed logins</p>
                  <ShieldAlert className="h-4 w-4 text-gray-400" />
                </div>
                <p className="mt-2 text-2xl font-bold text-gray-900">{failedLogins}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {uniqueIps} unique IPs · {data.range.label}
                </p>
              </div>

              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-900">Privileged sessions</p>
                  <Lock className="h-4 w-4 text-gray-400" />
                </div>
                <p className="mt-2 text-2xl font-bold text-gray-900">
                  {data.security.devSessions + data.security.superAdminSessions}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {data.security.devSessions} dev · {data.security.superAdminSessions} super admin
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {data.security.findings.map((item) => (
                <div key={item.key} className="rounded-xl border border-gray-100 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{item.label}</p>
                      <p className="mt-1 text-sm text-gray-600">{item.detail}</p>
                    </div>
                    <p className={`text-lg font-bold tabular-nums ${valueTone(item.status)}`}>
                      {item.value}
                    </p>
                  </div>
                  {item.actionUrl ? (
                    <div className="mt-2">
                      <Link href={item.actionUrl} className="text-xs font-semibold text-[#2A4792] hover:underline">
                        Review
                      </Link>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </DevCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
        <DevCard
          title="Security Alerts"
          subtitle={`Click an alert to open its record in Audit Timeline (${data.range.label}).`}
          actions={
            <span className="inline-flex items-center gap-1 rounded-full bg-[#EEF2FA] px-2.5 py-1 text-xs font-semibold text-[#2A4792]">
              <BellRing className="h-3.5 w-3.5" />
              {data.alerts.length} shown
            </span>
          }
        >
          <div className="space-y-3">
            {data.alerts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
                No security alerts were detected in this date range.
              </div>
            ) : (
              data.alerts.map((alert) => {
                const href = alert.actionUrl ?? `/dev/audit?event=${encodeURIComponent(alert.id)}`;
                return (
                  <button
                    key={alert.id}
                    type="button"
                    onClick={() => router.push(href)}
                    className="group w-full rounded-xl border border-gray-100 px-4 py-3 text-left transition-colors hover:border-[#2A4792]/30 hover:bg-[#EEF2FA]/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-gray-900">{alert.title}</p>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${severityClasses(alert.severity)}`}
                          >
                            {alert.severity}
                          </span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                            {alert.source === "security_alerts" ? "live alert" : "audit record"}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-gray-600">{alert.message}</p>
                        <p className="mt-1 text-xs text-gray-400">{formatDateTime(alert.createdAt)}</p>
                      </div>
                      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-gray-300 transition-colors group-hover:text-[#2A4792]" />
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </DevCard>

        <div className="space-y-6">
          <DevCard title="Recommended Actions" subtitle={`Based on checks for ${data.range.label}.`}>
            <div className="space-y-3">
              {data.recommendations.length === 0 ? (
                <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50 px-4 py-6 text-sm text-emerald-700">
                  No immediate action needed for this date range.
                </div>
              ) : (
                data.recommendations.map((item, index) => (
                  <div key={`${index}-${item}`} className="rounded-xl border border-gray-100 px-4 py-3">
                    <p className="text-sm text-gray-700">{item}</p>
                  </div>
                ))
              )}
            </div>
          </DevCard>

          <DevCard
            title="Recent DB Errors"
            subtitle={`Database-related failures in ${data.range.label}.`}
          >
            <div className="space-y-3">
              {data.database.recentErrors.length === 0 ? (
                <p className="text-sm text-gray-500">No database-related errors in this date range.</p>
              ) : (
                data.database.recentErrors.map((item) => (
                  <div key={item.id} className="rounded-xl border border-gray-100 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{item.source}</p>
                        <p className="mt-1 text-sm text-gray-600">{item.message}</p>
                        <p className="mt-1 text-xs text-gray-400">{formatDateTime(item.createdAt)}</p>
                      </div>
                      <span className="text-xs font-semibold text-gray-700">{item.severity}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </DevCard>
        </div>
      </div>
    </div>
  );
}
