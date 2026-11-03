"use client";

import React, { useState } from "react";
import { InlineLoader } from "@/app/components/Loader";
import { DevCard } from "@/app/dev/components/DevCard";
import { DevKpiStrip } from "@/app/dev/components/DevKpiStrip";
import { useDevEndpoint } from "@/app/dev/hooks/useDevEndpoint";

type IntegritySummary = {
  checks: Array<{
    key: string;
    label: string;
    status: "ok" | "warning" | "error";
    issueCount: number;
  }>;
};

type IntegrityDetail = Array<{ id: string; label: string; detail: string }>;

export function IntegritySection() {
  const { data, loading, error } = useDevEndpoint<IntegritySummary>("/api/dev/integrity/checks");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const { data: detail, loading: detailLoading } = useDevEndpoint<IntegrityDetail>(
    selectedKey ? `/api/dev/integrity/checks/${encodeURIComponent(selectedKey)}` : null,
    [selectedKey],
  );

  if (loading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <InlineLoader />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {error ?? "Failed to load integrity checks."}
      </div>
    );
  }

  const warningCount = data.checks.filter((item) => item.status === "warning").length;
  const errorCount = data.checks.filter((item) => item.status === "error").length;

  return (
    <div className="space-y-6">
      <DevKpiStrip
        items={[
          { label: "Checks", value: data.checks.length },
          { label: "Warnings", value: warningCount, tone: "warning" },
          { label: "Errors", value: errorCount, tone: "danger" },
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-[1fr,0.9fr]">
        <DevCard title="Integrity checks" subtitle="Read-only platform integrity probes.">
          <div className="space-y-3">
            {data.checks.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setSelectedKey(item.key)}
                className={`w-full rounded-xl border px-4 py-3 text-left ${
                  selectedKey === item.key
                    ? "border-[#2A4792] bg-[#EEF2FA]"
                    : "border-gray-100 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{item.label}</p>
                    <p className="mt-1 text-xs text-gray-500">{item.key}</p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-sm font-semibold ${
                        item.status === "error"
                          ? "text-red-600"
                          : item.status === "warning"
                            ? "text-amber-600"
                            : "text-green-600"
                      }`}
                    >
                      {item.status}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">{item.issueCount} issues</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </DevCard>

        <DevCard
          title="Check detail"
          subtitle="Sample affected records for the selected integrity issue."
        >
          {!selectedKey ? (
            <p className="text-sm text-gray-500">Select a check to inspect affected records.</p>
          ) : detailLoading ? (
            <div className="flex min-h-[240px] items-center justify-center">
              <InlineLoader />
            </div>
          ) : (
            <div className="space-y-3">
              {(detail ?? []).length === 0 ? (
                <p className="text-sm text-gray-500">No sample rows were returned for this check.</p>
              ) : (
                (detail ?? []).map((item) => (
                  <div key={item.id} className="rounded-xl border border-gray-100 px-4 py-3">
                    <p className="text-sm font-semibold text-gray-900">{item.label}</p>
                    <p className="mt-1 text-xs text-gray-500">{item.detail}</p>
                  </div>
                ))
              )}
            </div>
          )}
        </DevCard>
      </div>
    </div>
  );
}
