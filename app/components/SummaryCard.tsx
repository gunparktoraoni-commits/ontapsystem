"use client";

import { AnalyticsSummary } from "@/types/analytics";
import {
  Eye,
  Bookmark,
  TrendingUp,
  TrendingDown,
  Minus,
  LucideIcon,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface SummaryCardsProps {
  summary: AnalyticsSummary;
}

const formatNumber = (num: number): string => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toLocaleString();
};

const TrendIndicator = ({ change }: { change: string | null }) => {
  if (!change) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-400">
        <Minus className="h-3 w-3" />
        No change
      </span>
    );
  }

  const isPositive = change.startsWith("+");
  const isNegative = change.startsWith("-");

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
        isPositive
          ? "bg-emerald-50 text-emerald-700"
          : isNegative
            ? "bg-rose-50 text-rose-700"
            : "bg-gray-100 text-gray-600",
      )}
    >
      {isPositive ? (
        <TrendingUp className="h-3 w-3" />
      ) : isNegative ? (
        <TrendingDown className="h-3 w-3" />
      ) : (
        <Minus className="h-3 w-3" />
      )}
      <span>{change}</span>
      <span className="hidden font-normal text-gray-500 sm:inline">vs prev</span>
    </div>
  );
};

interface AnalyticsMetricCardProps {
  title: string;
  value: number;
  change?: string | null;
  icon: LucideIcon;
  accent: string;
  loading?: boolean;
}

export function AnalyticsMetricCard({
  title,
  value,
  change = null,
  icon: Icon,
  accent,
  loading = false,
}: AnalyticsMetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: loading ? 0.72 : 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="flex h-full min-h-[220px] flex-col rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
    >
      <div className="mb-6 flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${accent}14`, color: accent }}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-auto space-y-3">
        <motion.p
          key={value}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl"
        >
          {formatNumber(value)}
        </motion.p>
        {change !== undefined && <TrendIndicator change={change} />}
      </div>
    </motion.div>
  );
}

export function ProfileViewsCard({
  summary,
  loading,
}: {
  summary: AnalyticsSummary;
  loading?: boolean;
}) {
  return (
    <AnalyticsMetricCard
      title="Total Profile Views"
      value={summary.total_views}
      change={summary.comparison.views_change}
      icon={Eye}
      accent="#2A4792"
      loading={loading}
    />
  );
}

export function ContactsAddedCard({
  summary,
  loading,
}: {
  summary: AnalyticsSummary;
  loading?: boolean;
}) {
  return (
    <AnalyticsMetricCard
      title="Total add contacts"
      value={summary.total_saves}
      change={summary.comparison.saves_change}
      icon={Bookmark}
      accent="#4785B8"
      loading={loading}
    />
  );
}


/** @deprecated Use ProfileViewsCard and ContactsAddedCard in the 2x2 layout */
export function SummaryCards({ summary }: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <ProfileViewsCard summary={summary} />
      <ContactsAddedCard summary={summary} />
    </div>
  );
}
