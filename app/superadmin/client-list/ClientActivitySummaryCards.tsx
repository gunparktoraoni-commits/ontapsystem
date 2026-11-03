"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CreditCard,
  MapPin,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DASHBOARD_CARD_SHELL, DASHBOARD_DARK_PANEL_STYLE } from "../components/ui/portalTokens";
import { PORTAL_ACCENTS } from "../components/ui";

export type ClientSummaryPeriodStat = {
  count: number;
  previous: number;
  percentage_change: number;
};

export type ClientActivitySummary = {
  total_clients: number;
  total_online: number;
  total_subscribers: number;
  subscription_breakdown: { basic: number; standard: number; premium: number };
  top_locations: Array<{ label: string; count: number }>;
  new_users: {
    today: ClientSummaryPeriodStat;
    week: ClientSummaryPeriodStat;
    month: ClientSummaryPeriodStat;
  };
};

type ClientActivitySummaryCardsProps = {
  summary: ClientActivitySummary | null;
  loading?: boolean;
};

const ROTATE_MS = 3200;

function formatPct(value: number): string {
  const abs = Math.abs(value);
  const formatted = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  if (value > 0) return `+${formatted}%`;
  if (value < 0) return `-${formatted}%`;
  return "0%";
}

function RotatingCard({
  label,
  headline,
  headlineCaption,
  icon: Icon,
  accent,
  slides,
  loading,
}: {
  label: string;
  headline: string;
  headlineCaption: string;
  icon: LucideIcon;
  accent: string;
  slides: Array<{
    key: string;
    primary: string;
    secondary: string;
    trend?: { pct: number; compareLabel: string } | null;
  }>;
  loading?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const safeSlides = slides.length ? slides : [{ key: "empty", primary: "0", secondary: "—", trend: null }];

  useEffect(() => {
    if (safeSlides.length <= 1) return;
    const timer = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % safeSlides.length);
    }, ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [safeSlides.length]);

  useEffect(() => {
    setIndex(0);
  }, [safeSlides.map((s) => s.key).join("|")]);

  const current = safeSlides[index % safeSlides.length]!;
  const trendUp = (current.trend?.pct ?? 0) > 0;
  const trendDown = (current.trend?.pct ?? 0) < 0;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        DASHBOARD_CARD_SHELL,
        "group flex h-full min-h-[168px] flex-col p-5 transition-all duration-300 hover:shadow-md sm:p-6",
      )}
      style={DASHBOARD_DARK_PANEL_STYLE}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${accent}18`, color: accent, border: `1px solid ${accent}30` }}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>

      {loading ? (
        <div className="mb-4 space-y-2">
          <div className="h-10 w-28 animate-pulse rounded-lg bg-slate-200/70" />
          <div className="h-3 w-32 animate-pulse rounded bg-slate-200/70" />
        </div>
      ) : (
        <p className="text-4xl font-black tracking-tight text-white tabular-nums sm:text-[2.6rem]">
            {headline}
          </p>
      )}

      <div className="mt-auto overflow-hidden">
        {loading ? (
          <div className="space-y-2">
            <div className="h-4 w-28 animate-pulse rounded bg-white/10" />
            <div className="h-3 w-40 animate-pulse rounded bg-white/10" />
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={current.key}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            >
              <p className="text-sm font-semibold tracking-tight text-slate-100 tabular-nums sm:text-base">
                {current.primary}
              </p>
              <p className="mt-1 text-[11px] font-light text-slate-400 sm:text-xs">{current.secondary}</p>
              {current.trend ? (
                <div className="mt-2 flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      trendUp && "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-400/30",
                      trendDown && "bg-rose-500/15 text-rose-400 ring-1 ring-rose-400/30",
                      !trendUp && !trendDown && "bg-slate-500/15 text-slate-400 ring-1 ring-slate-400/20",
                    )}
                  >
                    {trendUp ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : trendDown ? (
                      <TrendingDown className="h-3 w-3" />
                    ) : null}
                    {formatPct(current.trend.pct)}
                  </span>
                  <span className="text-[10px] font-light text-slate-500">{current.trend.compareLabel}</span>
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>
        )}

        {safeSlides.length > 1 && !loading ? (
          <div className="mt-3 flex gap-1.5">
            {safeSlides.map((slide, i) => (
              <span
                key={slide.key}
                className={cn(
                  "h-1 rounded-full transition-all duration-500",
                  i === index % safeSlides.length ? "w-4 bg-white/80" : "w-1.5 bg-white/25",
                )}
              />
            ))}
          </div>
        ) : null}
      </div>
    </motion.article>
  );
}

export function ClientActivitySummaryCards({
  summary,
  loading = false,
}: ClientActivitySummaryCardsProps) {
  const locationSlides = useMemo(() => {
    const locations = summary?.top_locations ?? [];
    if (!locations.length) {
      return [
        {
          key: "no-location",
          primary: "No location data yet",
          secondary: "Registered users will appear here once location data is available",
          trend: null as { pct: number; compareLabel: string } | null,
        },
      ];
    }
    return locations.map((loc, i) => ({
      key: `loc-${i}-${loc.label}`,
      primary: `${loc.count} users`,
      secondary: `Top location #${i + 1} · ${loc.label}`,
      trend: null as { pct: number; compareLabel: string } | null,
    }));
  }, [summary?.top_locations]);

  const subscriptionSlides = useMemo(() => {
    const breakdown = summary?.subscription_breakdown ?? { basic: 0, standard: 0, premium: 0 };
    const total = summary?.total_subscribers ?? 0;
    return [
      {
        key: "basic",
        primary: String(breakdown.basic),
        secondary: `Basic subscribers`,
        trend: null,
      },
      {
        key: "standard",
        primary: String(breakdown.standard),
        secondary: `Standard subscribers`,
        trend: null,
      },
      {
        key: "premium",
        primary: String(breakdown.premium),
        secondary: `Premium subscribers`,
        trend: null,
      },
    ];
  }, [summary?.subscription_breakdown, summary?.total_subscribers]);

  const newlyAddedSlides = useMemo(() => {
    const nu = summary?.new_users ?? {
      today: { count: 0, previous: 0, percentage_change: 0 },
      week: { count: 0, previous: 0, percentage_change: 0 },
      month: { count: 0, previous: 0, percentage_change: 0 },
    };
    return [
      {
        key: "today",
        primary: String(nu.today.count),
        secondary: "New users today",
        trend: { pct: nu.today.percentage_change, compareLabel: "vs yesterday" },
      },
      {
        key: "week",
        primary: String(nu.week.count),
        secondary: "New users this week",
        trend: { pct: nu.week.percentage_change, compareLabel: "vs last week" },
      },
      {
        key: "month",
        primary: String(nu.month.count),
        secondary: "New users this month",
        trend: { pct: nu.month.percentage_change, compareLabel: "vs last month" },
      },
    ];
  }, [summary?.new_users]);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 sm:gap-5">
      <RotatingCard
        label="Total Clients"
        headline={String(summary?.total_clients ?? 0)}
        headlineCaption=""
        icon={MapPin}
        accent={PORTAL_ACCENTS.users}
        slides={locationSlides}
        loading={loading}
      />
      <RotatingCard
        label="Online Now"
        headline={String(summary?.total_online ?? 0)}
        headlineCaption=""
        icon={Wifi}
        accent={PORTAL_ACCENTS.revenue}
        slides={[
          {
            key: "online",
            primary: "Live activity snapshot",
            secondary: "Users active in the last 5 minutes",
            trend: null,
          },
        ]}
        loading={loading}
      />
      <RotatingCard
        label="Total Subscribed"
        headline={String(summary?.total_subscribers ?? 0)}
        headlineCaption=""
        icon={CreditCard}
        accent={PORTAL_ACCENTS.affiliates}
        slides={subscriptionSlides}
        loading={loading}
      />
      <RotatingCard
        label="Newly Added"
        headline={String(summary?.new_users?.today.count ?? 0)}
        headlineCaption=""
        icon={UserPlus}
        accent={PORTAL_ACCENTS.bizcards}
        slides={newlyAddedSlides}
        loading={loading}
      />
    </div>
  );
}
