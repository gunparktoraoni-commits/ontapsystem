"use client";

import { SectionLoader } from "./Loader";
import { ViewsOverTime, SavesOverTime } from "@/types/analytics";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface ChartsProps {
  viewsData: ViewsOverTime[];
  savesData: SavesOverTime[];
  loading?: boolean;
  compact?: boolean;
}

export function EngagementMetricsChart({
  viewsData,
  savesData,
  loading = false,
}: ChartsProps) {
  if (loading && viewsData.length === 0) {
    return <SectionLoader text="Loading engagement metrics..." />;
  }

  const chartData = viewsData.map((view, index) => ({
    date: view.date,
    views: view.views,
    saves: savesData[index]?.saves ?? 0,
  }));

  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ name: string; value: number; color: string }>;
    label?: string;
  }) => {
    if (!active || !payload?.length || !label) return null;

    return (
      <div className="rounded-xl border border-gray-100 bg-white p-3 text-xs shadow-xl">
        <p className="mb-2 font-semibold text-gray-700">
          {format(new Date(label), "MMM d, yyyy")}
        </p>
        {payload.map((entry) => (
          <div key={entry.name} className="mb-1 flex items-center gap-2">
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-gray-500">{entry.name}:</span>
            <span className="font-semibold text-gray-900">{entry.value}</span>
          </div>
        ))}
      </div>
    );
  };

  const tickFormatter = (value: string) => {
    try {
      return format(new Date(value), chartData.length > 14 ? "MMM d" : "d MMM");
    } catch {
      return value;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: loading ? 0.72 : 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.05 }}
      className="flex h-full min-h-[320px] flex-col rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
    >
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900">Engagement Metrics</h3>
        <p className="mt-1 text-sm text-gray-500">Profile views and contact saves over time</p>
      </div>

      <div className={cn("min-h-[240px] flex-1 w-full", loading && "animate-pulse")}>
        {chartData.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            No engagement data for this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EEF2F7" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "#94A3B8" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={tickFormatter}
                dy={8}
                minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#94A3B8" }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                content={<CustomTooltip />}
                cursor={{ fill: "#F4F7FC", opacity: 0.6 }}
              />
              <Legend
                verticalAlign="top"
                align="right"
                iconType="circle"
                wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
              />
              <Bar
                dataKey="views"
                name="Profile Views"
                fill="#2A4792"
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
              />
              <Bar
                dataKey="saves"
                name="Contact Saves"
                fill="#4785B8"
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </motion.div>
  );
}

/** @deprecated Use EngagementMetricsChart */
export function Charts(props: ChartsProps) {
  return <EngagementMetricsChart {...props} />;
}
