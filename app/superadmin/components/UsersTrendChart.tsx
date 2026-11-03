"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { InlineLoader } from "@/app/components/Loader";
import { PortalPanel } from "./ui/PortalPanel";
import { DASHBOARD_CARD_MIN_H } from "./ui/portalTokens";
import { cn } from "@/lib/utils";
import {
  asRecord,
  fetchDashboardMetrics,
  type DateFilter,
} from "./dashboardApi";

// ─── Types (unchanged) ────────────────────────────────────────────────────────

export type TierTrendBar = {
  key: string;
  label: string;
  current: number;
  previous: number;
  change: number;
  percentage_change: number;
};

type ChartRow = TierTrendBar & {
  shortLabel: string;
  changeLabel: string;
  deltaColor: string;
};

type PeriodOption = {
  id: DateFilter | "custom";
  label: string;
};

// ─── Constants (logic unchanged) ──────────────────────────────────────────────

const PERIOD_OPTIONS: PeriodOption[] = [
  { id: "today", label: "Today" },
  { id: "this_week", label: "This Week" },
  { id: "this_month", label: "This Month" },
  { id: "custom", label: "Custom Range" },
];

/* Gradient anchor colors — referenced via url(#grad_<key>) in Cell fills.
   Actual gradient definitions live in the <defs> block inside BarChart. */
const BAR_FILL: Record<string, string> = {
  new_users: "url(#grad_new_users)",
  basic:     "url(#grad_basic)",
  standard:  "url(#grad_standard)",
  premium:   "url(#grad_premium)",
};

/* Fallback solid color used when gradient lookup misses — Total Users blue family */
const BAR_SOLID: Record<string, string> = {
  new_users: "#2A4792",
  basic:     "#3B57A3",
  standard:  "#4785B8",
  premium:   "#5B6FA8",
};

// ─── Logic helpers (unchanged) ─────────────────────────────────────────────────

function mapTierTrend(payload: unknown): TierTrendBar[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root ?? {};
  const trend = data.user_tier_trend;
  if (!Array.isArray(trend)) return [];

  return trend
    .map((raw) => {
      const row = asRecord(raw);
      if (!row) return null;
      return {
        key:               String(row.key ?? ""),
        label:             String(row.label ?? row.key ?? "Users"),
        current:           Number(row.current) || 0,
        previous:          Number(row.previous) || 0,
        change:            Number(row.change) || 0,
        percentage_change: Number(row.percentage_change) || 0,
      };
    })
    .filter((row): row is TierTrendBar => row !== null && Boolean(row.key));
}

function formatDelta(change: number): string {
  if (change > 0) return `+${change.toLocaleString()}`;
  if (change < 0) return change.toLocaleString();
  return "0";
}

const SHORT_LABELS: Record<string, string> = {
  new_users: "New Users",
  basic:     "Basic",
  standard:  "Standard",
  premium:   "Premium",
};

function shortAxisLabel(key: string, label: string): string {
  return SHORT_LABELS[key] ?? label.replace(" Accounts", "");
}

// ─── Sub-components (visual-only changes) ─────────────────────────────────────

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartRow }>;
}) {
  if (!active || !payload?.length || !payload[0]?.payload) return null;
  const row = payload[0].payload;

  return (
    /* Dark glassmorphism tooltip matching the reference image aesthetic */
    <div
      className="rounded-2xl px-4 py-3 text-xs"
      style={{
        background:    "linear-gradient(135deg, rgba(13,21,37,0.97) 0%, rgba(20,32,60,0.97) 100%)",
        border:        "1px solid rgba(59,87,163,0.45)",
        boxShadow:     "0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(59,87,163,0.15)",
        backdropFilter: "blur(12px)",
        minWidth:      "160px",
      }}
    >
      <p className="font-bold tracking-wide mb-2" style={{ color: "#e2e8f0", fontSize: 12 }}>
        {row.label}
      </p>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span style={{ color: "#94a3b8", fontSize: 11 }}>Current</span>
          <span className="font-semibold" style={{ color: "#f1f5f9", fontSize: 11 }}>
            {row.current.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span style={{ color: "#94a3b8", fontSize: 11 }}>Previous</span>
          <span className="font-semibold" style={{ color: "#f1f5f9", fontSize: 11 }}>
            {row.previous.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Delta row */}
      <div
        className="mt-2 pt-2 flex items-center justify-between gap-4"
        style={{ borderTop: "1px solid rgba(59,87,163,0.25)" }}
      >
        <span style={{ color: "#94a3b8", fontSize: 11 }}>Change</span>
        <span className="font-bold" style={{ color: row.deltaColor, fontSize: 11 }}>
          {row.changeLabel} ({row.percentage_change > 0 ? "+" : ""}
          {row.percentage_change.toFixed(1)}%)
        </span>
      </div>
    </div>
  );
}

function DeltaBarLabel({
  x,
  y,
  width,
  value,
  index,
  rows,
}: {
  x?: number;
  y?: number;
  width?: number;
  value?: string | number;
  index?: number;
  rows: ChartRow[];
}) {
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    index === undefined
  )
    return null;
  const row = rows[index];
  if (!row) return null;

  return (
    <text
      x={x + width / 2}
      y={y - 8}
      fill={row.deltaColor}
      fontSize={11}
      fontWeight={700}
      textAnchor="middle"
      style={{ filter: "drop-shadow(0 0 4px rgba(0,0,0,0.6))" }}
    >
      {String(value ?? row.changeLabel)}
    </text>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function UsersTrendChart() {
  // ── State & refs (unchanged) ──────────────────────────────────────────────
  const [period, setPeriod]         = useState<DateFilter | "custom">("this_week");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd]   = useState("");
  const [bars, setBars]             = useState<TierTrendBar[]>([]);
  const [loading, setLoading]       = useState(true);
  const [menuOpen, setMenuOpen]     = useState(false);
  const menuRef                     = useRef<HTMLDivElement>(null);

  const periodLabel  = PERIOD_OPTIONS.find((o) => o.id === period)?.label ?? "This Week";
  const customReady  = period !== "custom" || (Boolean(customStart) && Boolean(customEnd));

  // ── Data-fetch effect (unchanged) ─────────────────────────────────────────
  useEffect(() => {
    if (!customReady) return;

    const controller = new AbortController();
    let cancelled    = false;

    async function run() {
      setLoading(true);
      try {
        const filter: DateFilter = period === "custom" ? "custom" : period;
        const payload = await fetchDashboardMetrics(
          filter,
          controller.signal,
          period === "custom" ? { start: customStart, end: customEnd } : undefined,
        );
        if (!cancelled) setBars(mapTierTrend(payload));
      } catch {
        if (!cancelled) setBars([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [period, customStart, customEnd, customReady]);

  // ── Outside-click handler (unchanged) ─────────────────────────────────────
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  // ── Derived chart data (unchanged) ────────────────────────────────────────
  const chartData = useMemo<ChartRow[]>(
    () =>
      bars.map((bar) => ({
        ...bar,
        shortLabel:  shortAxisLabel(bar.key, bar.label),
        changeLabel: formatDelta(bar.change),
        deltaColor:  bar.change >= 0 ? "#34d399" : "#f87171",
      })),
    [bars],
  );

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <PortalPanel
      title="Users Trend"
      variant="glass"
      className={cn("flex flex-col", DASHBOARD_CARD_MIN_H)}
      /*
       * PortalPanel receives its own card shell; we override it via the
       * wrapper below so the inner chart area matches the reference image.
       */
      action={
        /* ── Period selector ─────────────────────────────────────────────── */
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[rgba(42,71,146,0.45)] bg-[rgba(42,71,146,0.2)] px-3 text-xs font-semibold text-slate-200 shadow-sm backdrop-blur-sm transition-all hover:bg-[rgba(42,71,146,0.32)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2A4792]/40"
          >
            {periodLabel}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-200 ${
                menuOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {menuOpen && (
            <div className="absolute right-0 z-20 mt-2 min-w-[180px] overflow-hidden rounded-2xl border border-[rgba(42,71,146,0.4)] bg-[#0d1525]/95 py-1 shadow-xl backdrop-blur-xl">
              {PERIOD_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setPeriod(option.id);
                    setMenuOpen(false);
                  }}
                  className={`block w-full px-4 py-2.5 text-left text-xs font-semibold transition-colors ${
                    period === option.id
                      ? "bg-[rgba(42,71,146,0.35)] text-[#93c5fd]"
                      : "text-slate-300 hover:bg-[rgba(42,71,146,0.2)]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      }
    >
      {/* ── Dark chart wrapper ─────────────────────────────────────────────── */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background:
            "linear-gradient(160deg, rgba(42,71,146,0.22) 0%, rgba(11,18,32,0.88) 45%, rgba(8,14,30,0.94) 100%)",
          border: "1px solid rgba(42,71,146,0.32)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          marginTop: "8px",
        }}
      >
        {/* ── Custom-date pickers ─────────────────────────────────────────── */}
        {period === "custom" && (
          <div className="flex flex-wrap items-center gap-2 px-5 pt-4 pb-0">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="h-9 rounded-xl border border-[#3B57A3]/40 bg-[#111d35] px-3 text-xs font-medium text-[#e2e8f0] outline-none focus:border-[#93c5fd] focus:ring-1 focus:ring-[#93c5fd]/40"
              style={{ colorScheme: "dark" }}
              aria-label="Start date"
            />
            <span className="text-xs text-[#64748b]">to</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="h-9 rounded-xl border border-[#3B57A3]/40 bg-[#111d35] px-3 text-xs font-medium text-[#e2e8f0] outline-none focus:border-[#93c5fd] focus:ring-1 focus:ring-[#93c5fd]/40"
              style={{ colorScheme: "dark" }}
              aria-label="End date"
            />
          </div>
        )}

        {/* ── Loading state ───────────────────────────────────────────────── */}
        {loading ? (
          <div
            className="flex h-64 items-center justify-center gap-2.5 text-xs font-medium"
            style={{ color: "#4b78d9" }}
          >
            <InlineLoader />
            <span style={{ color: "#64748b" }}>Loading trend data…</span>
          </div>

        ) : !customReady ? (
          /* ── Awaiting custom range ────────────────────────────────────── */
          <div
            className="flex h-64 flex-col items-center justify-center gap-2 text-xs"
            style={{ color: "#475569" }}
          >
            <span
              className="text-lg"
              style={{ filter: "drop-shadow(0 0 8px rgba(59,87,163,0.6))" }}
            >
              📅
            </span>
            Select a start and end date to view the custom range.
          </div>

        ) : chartData.length === 0 ? (
          /* ── Empty state ────────────────────────────────────────────── */
          <div
            className="flex h-64 flex-col items-center justify-center gap-2 text-xs"
            style={{ color: "#475569" }}
          >
            <span
              className="text-lg"
              style={{ filter: "drop-shadow(0 0 8px rgba(59,87,163,0.4))" }}
            >
              📊
            </span>
            No user trend data for this period.
          </div>

        ) : (
          /* ── Chart ─────────────────────────────────────────────────── */
          <div className="px-2 pb-4 pt-3">
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 32, right: 16, left: 0, bottom: 4 }}
                  barCategoryGap="28%"
                >
                  {/* ── SVG gradient defs (visual only) ─────────────────── */}
                  <defs>
                    {/* Total Users blue family — consistent palette */}
                    <linearGradient id="grad_new_users" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#4785B8" stopOpacity={1}   />
                      <stop offset="100%" stopColor="#2A4792" stopOpacity={0.9} />
                    </linearGradient>
                    <linearGradient id="grad_basic" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#5B7BC4" stopOpacity={1}   />
                      <stop offset="100%" stopColor="#2A4792" stopOpacity={0.85} />
                    </linearGradient>
                    <linearGradient id="grad_standard" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#6B8FD4" stopOpacity={1}   />
                      <stop offset="100%" stopColor="#3B57A3" stopOpacity={0.85} />
                    </linearGradient>
                    <linearGradient id="grad_premium" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#93c5fd" stopOpacity={1}   />
                      <stop offset="100%" stopColor="#2A4792" stopOpacity={0.88} />
                    </linearGradient>
                    {/* Subtle glow filter applied to bars */}
                    <filter id="barGlow" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>

                  {/* Grid — subtle dark lines matching reference */}
                  <CartesianGrid
                    strokeDasharray="3 6"
                    vertical={false}
                    stroke="rgba(42,71,146,0.18)"
                    strokeWidth={1}
                  />

                  {/* X axis */}
                  <XAxis
                    dataKey="shortLabel"
                    tick={{
                      fontSize:   11,
                      fill:       "#64748b",
                      fontWeight: 600,
                    }}
                    axisLine={{ stroke: "rgba(59,87,163,0.2)" }}
                    tickLine={false}
                    interval={0}
                  />

                  {/* Y axis */}
                  <YAxis
                    tick={{ fontSize: 10, fill: "#475569" }}
                    axisLine={{ stroke: "rgba(59,87,163,0.2)" }}
                    tickLine={false}
                    allowDecimals={false}
                    width={38}
                    label={{
                      value:    "Users",
                      angle:    -90,
                      position: "insideLeft",
                      offset:   12,
                      style:    {
                        fontSize:   10,
                        fill:       "#475569",
                        fontWeight: 600,
                      },
                    }}
                  />

                  {/* Tooltip */}
                  <Tooltip
                    content={<TrendTooltip />}
                    cursor={{ fill: "rgba(59,87,163,0.06)", radius: 8 }}
                  />

                  {/* Bars */}
                  <Bar
                    dataKey="current"
                    radius={[8, 8, 0, 0]}
                    maxBarSize={56}
                    style={{ filter: "url(#barGlow)" }}
                  >
                    {chartData.map((entry) => (
                      <Cell
                        key={entry.key}
                        fill={BAR_FILL[entry.key] ?? BAR_SOLID[entry.key] ?? "#3B57A3"}
                      />
                    ))}

                    {/* Delta labels above bars */}
                    <LabelList
                      dataKey="changeLabel"
                      content={(props) => (
                        <DeltaBarLabel
                          x={
                            typeof props.x === "number"
                              ? props.x
                              : Number(props.x)
                          }
                          y={
                            typeof props.y === "number"
                              ? props.y
                              : Number(props.y)
                          }
                          width={
                            typeof props.width === "number"
                              ? props.width
                              : Number(props.width)
                          }
                          value={
                            typeof props.value === "string" ||
                            typeof props.value === "number"
                              ? props.value
                              : undefined
                          }
                          index={props.index}
                          rows={chartData}
                        />
                      )}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Caption */}
            <p
              className="mt-2 text-center font-semibold uppercase tracking-widest"
              style={{ fontSize: 9, color: "rgba(59,87,163,0.55)", letterSpacing: "0.15em" }}
            >
              Account Type · Δ vs Previous Period
            </p>
          </div>
        )}
      </div>
    </PortalPanel>
  );
}