"use client";

import React from "react";

export function DevKpiStrip({
  items,
}: {
  items: Array<{ label: string; value: string | number; tone?: "default" | "danger" | "warning" | "success" }>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs font-medium text-gray-500">{item.label}</p>
          <p
            className={`mt-2 text-2xl font-bold ${
              item.tone === "danger"
                ? "text-red-600"
                : item.tone === "warning"
                  ? "text-amber-600"
                  : item.tone === "success"
                    ? "text-green-600"
                    : "text-[#2A4792]"
            }`}
          >
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}
