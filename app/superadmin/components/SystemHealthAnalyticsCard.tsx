"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  ChevronDown,
  Database,
  ShieldAlert,
  Wifi,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { DASHBOARD_DARK_PANEL_STYLE } from "./ui/portalTokens";
import { SkeletonLoader } from "@/app/components/Loader";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";

type MetricId =
  | "systemStatus"
  | "trafficStatus"
  | "avgResponseTime"
  | "errorRate"
  | "dbLatency"
  | "securityAlerts";

type MetricItem = {
  id: MetricId;
  label: string;
  value: string;
  unit?: string;
  delta: string;
  deltaTone: "positive" | "warning";
  icon: LucideIcon;
  sparkValues: number[];
};

const DELTA_STYLES: Record<MetricItem["deltaTone"], CSSProperties> = {
  positive: {
    background: "rgba(52,211,153,0.12)",
    color: "#34d399",
    border: "1px solid rgba(52,211,153,0.3)",
  },
  warning: {
    background: "rgba(245,158,11,0.12)",
    color: "#fbbf24",
    border: "1px solid rgba(245,158,11,0.3)",
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function formatUptime(seconds: number): { value: string; unit: string } {
  if (seconds >= 86_400) {
    return { value: (seconds / 86_400).toFixed(1), unit: "d" };
  }
  if (seconds >= 3_600) {
    return { value: (seconds / 3_600).toFixed(1), unit: "h" };
  }
  if (seconds >= 60) {
    return { value: String(Math.round(seconds / 60)), unit: "m" };
  }
  return { value: String(Math.max(0, Math.round(seconds))), unit: "s" };
}

function formatTraffic(count: number): { value: string; unit: string } {
  if (count >= 1_000_000) {
    return { value: (count / 1_000_000).toFixed(1), unit: "M req" };
  }
  if (count >= 1_000) {
    return { value: (count / 1_000).toFixed(1), unit: "K req" };
  }
  return { value: String(Math.round(count)), unit: "req" };
}

function buildSparkPath(values: number[]): string {
  if (values.length === 0) return "M8 35 L292 35";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 284;
  const height = 46;
  const step = values.length > 1 ? width / (values.length - 1) : 0;

  return values
    .map((value, index) => {
      const x = 8 + index * step;
      const y = 58 - ((value - min) / span) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function mapSystemHealthMetrics(apiResponse: unknown): MetricItem[] {
  const root = asRecord(apiResponse);
  const data = asRecord(root?.data) ?? root ?? {};
  const api = asRecord(data.api) ?? {};
  const errors = asRecord(data.errors) ?? {};
  const security = asRecord(data.security) ?? {};
  const databases = asRecord(data.databases) ?? {};
  const mainDb = asRecord(databases.main) ?? {};
  const analyticsDb = asRecord(databases.analytics) ?? {};

  const status = (firstString(data.status) ?? "unknown").toLowerCase();
  const uptimeSeconds = firstNumber(data.uptime_seconds) ?? 0;
  const totalRequests = firstNumber(api.total_requests) ?? 0;
  const avgResponseMs = firstNumber(api.average_response_time_ms) ?? 0;
  const slowRequestRate = firstNumber(api.slow_request_rate_percent) ?? 0;
  const errorRate = firstNumber(errors.error_rate_percent) ?? 0;
  const errorCount = firstNumber(errors.error_count_last_hour) ?? 0;
  const alerts = firstNumber(security.active_alerts_last_24h) ?? 0;
  const mainLatency = firstNumber(mainDb.latency_ms);
  const analyticsLatency = firstNumber(analyticsDb.latency_ms);
  const dbLatency =
    mainLatency !== null && analyticsLatency !== null
      ? Math.round((mainLatency + analyticsLatency) / 2)
      : mainLatency ?? analyticsLatency ?? 0;
  const mainStatus = (firstString(mainDb.status) ?? "unknown").toLowerCase();
  const analyticsStatus = (firstString(analyticsDb.status) ?? "unknown").toLowerCase();

  const uptime = formatUptime(uptimeSeconds);
  const traffic = formatTraffic(totalRequests);
  const isHealthy = status === "healthy";

  return [
    {
      id: "systemStatus",
      label: "System Status",
      value: isHealthy ? "OK" : status === "degraded" ? "WARN" : "N/A",
      unit: undefined,
      delta: `${uptime.value}${uptime.unit} uptime`,
      deltaTone: isHealthy ? "positive" : "warning",
      icon: Activity,
      sparkValues: [isHealthy ? 1 : 0.4, isHealthy ? 1 : 0.5, isHealthy ? 0.95 : 0.45, isHealthy ? 1 : 0.35],
    },
    {
      id: "trafficStatus",
      label: "API Traffic",
      value: traffic.value,
      unit: traffic.unit,
      delta: `${slowRequestRate.toFixed(1)}% slow`,
      deltaTone: slowRequestRate > 10 ? "warning" : "positive",
      icon: Wifi,
      sparkValues: [
        Math.max(0, totalRequests * 0.55),
        Math.max(0, totalRequests * 0.7),
        Math.max(0, totalRequests * 0.85),
        totalRequests,
      ],
    },
    {
      id: "avgResponseTime",
      label: "AVG Response Time",
      value: String(Math.round(avgResponseMs)),
      unit: "ms",
      delta: `${Math.round(firstNumber(api.slow_request_count) ?? 0)} slow req`,
      deltaTone: avgResponseMs > 500 ? "warning" : "positive",
      icon: Zap,
      sparkValues: [
        Math.max(1, avgResponseMs * 0.8),
        Math.max(1, avgResponseMs * 1.1),
        Math.max(1, avgResponseMs * 0.9),
        Math.max(1, avgResponseMs),
      ],
    },
    {
      id: "errorRate",
      label: "Error Rate (1h)",
      value: errorRate.toFixed(2),
      unit: "%",
      delta: `${errorCount} errors`,
      deltaTone: errorRate > 5 || errorCount > 0 ? "warning" : "positive",
      icon: ShieldAlert,
      sparkValues: [
        Math.max(0, errorRate * 0.6),
        Math.max(0, errorRate * 0.9),
        Math.max(0, errorRate * 1.2),
        Math.max(0, errorRate),
      ],
    },
    {
      id: "dbLatency",
      label: "DB Latency",
      value: String(Math.round(dbLatency)),
      unit: "ms",
      delta: `main ${mainStatus} · analytics ${analyticsStatus}`,
      deltaTone:
        mainStatus !== "healthy" || analyticsStatus !== "healthy" || dbLatency > 300
          ? "warning"
          : "positive",
      icon: Database,
      sparkValues: [
        Math.max(1, dbLatency * 0.85),
        Math.max(1, dbLatency * 1.05),
        Math.max(1, dbLatency * 0.95),
        Math.max(1, dbLatency),
      ],
    },
    {
      id: "securityAlerts",
      label: "Security Alerts (24h)",
      value: String(alerts),
      unit: undefined,
      delta: alerts > 0 ? "Needs review" : "Clear",
      deltaTone: alerts > 0 ? "warning" : "positive",
      icon: ShieldAlert,
      sparkValues: [Math.max(0, alerts - 1), alerts, Math.max(0, alerts - 1), alerts],
    },
  ];
}

function MetricDetails({ selectedMetric }: { selectedMetric: MetricItem }) {
  const linePath = useMemo(
    () => buildSparkPath(selectedMetric.sparkValues),
    [selectedMetric.sparkValues],
  );
  const lineColor = selectedMetric.deltaTone === "warning" ? "#f08a24" : "#2dc870";
  const gradientId = `health-gradient-${selectedMetric.id}`;
  const glowId = `health-glow-${selectedMetric.id}`;

  return (
    <div className="relative h-20 overflow-hidden rounded-lg">
      <svg viewBox="0 0 300 70" className="h-full w-full">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.35" />
            <stop offset="55%" stopColor={lineColor} stopOpacity="0.95" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0.7" />
          </linearGradient>
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <motion.path
          d={linePath}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="2.8"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0.45 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
          filter={`url(#${glowId})`}
        />
      </svg>
    </div>
  );
}

function MetricValue({ selectedMetric }: { selectedMetric: MetricItem }) {
  return (
    <p className="mt-1.5 flex items-end gap-1 text-4xl font-black tracking-tight" style={{ color: "#f1f5f9" }}>
      <span>{selectedMetric.value}</span>
      {selectedMetric.unit ? (
        <span className="pb-1 text-3xl font-semibold" style={{ color: "#94a3b8" }}>
          {selectedMetric.unit}
        </span>
      ) : null}
    </p>
  );
}

function readAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return (
    window.localStorage.getItem("auth_token") ||
    window.localStorage.getItem("superadmin_token") ||
    window.sessionStorage.getItem("auth_token") ||
    window.sessionStorage.getItem("superadmin_token") ||
    null
  );
}

export default function SystemHealthAnalyticsCard() {
  const [metrics, setMetrics] = useState<MetricItem[]>([]);
  const [selectedMetricId, setSelectedMetricId] = useState<MetricId>("systemStatus");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectedMetric = metrics.find((metric) => metric.id === selectedMetricId) ?? metrics[0];
  const SelectedIcon = selectedMetric?.icon ?? Activity;

  useEffect(() => {
    let isMounted = true;

    async function fetchSystemHealth(): Promise<void> {
      setIsLoading(true);
      try {
        const token = readAuthToken();
        const response = await fetch(`${getFrontendApiBaseUrl()}/api/superadmin/system-health`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch system health: ${response.status}`);
        }

        const payload = await response.json();
        if (!isMounted) return;

        if (payload?.success && payload?.data) {
          const mapped = mapSystemHealthMetrics(payload);
          setMetrics(mapped);
          setSelectedMetricId((current) =>
            mapped.some((metric) => metric.id === current) ? current : mapped[0].id,
          );
          setError(null);
        } else {
          throw new Error("System health payload was incomplete.");
        }
      } catch (fetchError) {
        if (!isMounted) return;
        console.error("System health fetch error:", fetchError);
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load system health.");
        setMetrics([]);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void fetchSystemHealth();
    const pollInterval = setInterval(fetchSystemHealth, 30000);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, []);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-extrabold tracking-tight text-white">System Health Analytics</h3>
          {isLoading ? (
            <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ background: "#2A4792" }} />
          ) : null}
        </div>

        <div className="relative">
          <label htmlFor="system-health-metric" className="sr-only">
            Select system health metric
          </label>
          <select
            id="system-health-metric"
            value={selectedMetric?.id ?? "systemStatus"}
            onChange={(event) => setSelectedMetricId(event.target.value as MetricId)}
            disabled={metrics.length === 0}
            className="h-9 min-w-[11rem] appearance-none rounded-xl border border-[rgba(42,71,146,0.45)] bg-[rgba(42,71,146,0.2)] pl-3 pr-8 text-xs font-semibold text-slate-200 outline-none backdrop-blur-sm transition-all duration-200 focus:border-[#2A4792] focus:ring-2 focus:ring-[#2A4792]/30 disabled:opacity-50"
          >
            {metrics.map((metric) => (
              <option key={metric.id} value={metric.id}>
                {metric.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          />
        </div>
      </div>

      <div
        className="relative min-h-46 overflow-hidden rounded-2xl p-4 sm:p-5"
        style={DASHBOARD_DARK_PANEL_STYLE}
      >
        {isLoading && metrics.length === 0 ? (
          <div className="space-y-4">
            <SkeletonLoader width="w-24" height="h-5" />
            <SkeletonLoader width="w-full" height="h-12" />
            <SkeletonLoader width="w-32" height="h-4" />
          </div>
        ) : error && metrics.length === 0 ? (
          <p className="text-sm font-semibold text-rose-300">{error}</p>
        ) : selectedMetric ? (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={selectedMetric.id}
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.24, ease: "easeInOut" }}
              className="flex h-full flex-col justify-between"
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl"
                  style={{
                    background: "rgba(59,87,163,0.15)",
                    color: "#93c5fd",
                    border: "1px solid rgba(59,87,163,0.35)",
                  }}
                >
                  <SelectedIcon className="h-5 w-5" />
                </span>
                <span
                  className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                  style={DELTA_STYLES[selectedMetric.deltaTone]}
                >
                  {selectedMetric.delta}
                </span>
              </div>

              <div className="text-left">
                <p
                  className="text-[10px] font-bold uppercase tracking-[0.12em]"
                  style={{ color: "#64748b" }}
                >
                  {selectedMetric.label}
                </p>
                <MetricValue selectedMetric={selectedMetric} />
              </div>

              <MetricDetails selectedMetric={selectedMetric} />
            </motion.div>
          </AnimatePresence>
        ) : (
          <p className="text-sm font-semibold text-slate-400">No system health data available.</p>
        )}
      </div>
    </>
  );
}
