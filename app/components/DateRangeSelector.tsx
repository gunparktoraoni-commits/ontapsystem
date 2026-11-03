"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type AnalyticsPeriod = "day" | "month" | "year";

export const ANALYTICS_PERIOD_STORAGE_KEY = "ontap-analytics-period";

export const PERIOD_OPTIONS: { label: string; value: AnalyticsPeriod }[] = [

  { label: "Day", value: "day" },
  { label: "Month", value: "month" },
  { label: "Year", value: "year" },
];

export function periodToApiParams(period: AnalyticsPeriod): {
  filter: string;
  startDate?: string;
  endDate?: string;
} {
  const today = new Date();
  const formatDate = (date: Date) => date.toISOString().slice(0, 10);

  switch (period) {
    case "day":
      return { filter: "today" };
    case "month":
      return { filter: "this_month" };
    case "year":
      return {
        filter: "custom",
        startDate: `${today.getUTCFullYear()}-01-01`,
        endDate: formatDate(today),
      };
  }
}
export function apiFilterToPeriod(
  filter: string,
  startDate?: string,
  endDate?: string,
): AnalyticsPeriod {
  if (filter === "today" || filter === "yesterday") return "day";
  if (filter === "this_month" || filter === "last_month") return "month";
  if (filter === "custom" && startDate?.endsWith("-01-01")) return "year";
  return "month";
}

export function readStoredAnalyticsPeriod(): AnalyticsPeriod {
  if (typeof window === "undefined") return "month";
  const stored = window.localStorage.getItem(ANALYTICS_PERIOD_STORAGE_KEY);
  if (stored === "day" || stored === "month" || stored === "year") return stored;
  return "month";
}

interface DateRangeSelectorProps {
  onRangeChange: (filter: string, startDate?: string, endDate?: string) => void;
  currentPeriod: AnalyticsPeriod;
  onPeriodChange: (period: AnalyticsPeriod) => void;
  compact?: boolean;
}

export function DateRangeSelector({
  onRangeChange,
  currentPeriod,
  onPeriodChange,
  compact = false,
}: DateRangeSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedLabel =
    PERIOD_OPTIONS.find((option) => option.value === currentPeriod)?.label ?? "Month";

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (period: AnalyticsPeriod) => {
    onPeriodChange(period);
    window.localStorage.setItem(ANALYTICS_PERIOD_STORAGE_KEY, period);
    const params = periodToApiParams(period);
    onRangeChange(params.filter, params.startDate, params.endDate);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={cn("relative", compact ? "" : "shrink-0")}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all",
          "hover:border-[#4785B8]/40 hover:text-[#2A4792] focus:outline-none focus:ring-2 focus:ring-[#4785B8]/20",
          open && "border-[#4785B8]/50 ring-2 ring-[#4785B8]/15",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selectedLabel}</span>
        <ChevronDown
          className={cn("h-4 w-4 text-gray-400 transition-transform", open && "rotate-180")}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 z-30 mt-2 min-w-[140px] overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-lg"
            role="listbox"
          >
            {PERIOD_OPTIONS.map((option) => {
              const isSelected = currentPeriod === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(option.value)}
                  className={cn(
                    "flex w-full items-center justify-between px-4 py-2.5 text-sm transition-colors",
                    isSelected
                      ? "bg-[#4785B8]/8 font-semibold text-[#2A4792]"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
                  )}
                >
                  {option.label}
                  {isSelected && <Check className="h-4 w-4 text-[#2A4792]" />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
