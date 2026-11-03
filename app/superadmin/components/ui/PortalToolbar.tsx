"use client";

import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

type FilterChip = {
  id: string;
  label: string;
  active?: boolean;
  onClick?: () => void;
};

type PortalToolbarProps = {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: FilterChip[];
  actions?: React.ReactNode;
  className?: string;
};

export function PortalToolbar({
  searchValue = "",
  onSearchChange,
  searchPlaceholder = "Search...",
  filters,
  actions,
  className,
}: PortalToolbarProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center">
        {onSearchChange ? (
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-11 w-full rounded-lg border border-gray-200 bg-white pl-10 pr-3 text-sm text-gray-700 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
        ) : null}
        {filters && filters.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {filters.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={chip.onClick}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30",
                  chip.active
                    ? "border-primary bg-primary text-white"
                    : "border-gray-200 bg-white text-gray-600 hover:border-primary/40 hover:bg-primary/5",
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
