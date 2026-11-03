"use client";

import { Search, X } from "lucide-react";

export default function SupportSearchBar({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="px-3 py-2 border-b border-gray-100 bg-white">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit();
          }}
          placeholder="Search messages..."
          className="w-full rounded-full border border-gray-200 bg-gray-50 pl-9 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
        {value && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
            onClick={() => {
              onChange("");
              onSubmit();
            }}
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
