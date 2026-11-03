"use client";

import React, { useMemo } from "react";
import { InlineLoader, SectionLoader } from "@/app/components/Loader";
import { DevCard } from "@/app/dev/components/DevCard";
import { DevKpiStrip } from "@/app/dev/components/DevKpiStrip";
import { useDevEndpoint } from "@/app/dev/hooks/useDevEndpoint";

type JobsData = {
  summary: {
    queuedEmails: number;
    failedEmails: number;
    failedJobs24h: number;
    failures: Record<string, number>;
  };
};

export default function DevJobsPage() {
  const { data, loading, error } = useDevEndpoint<JobsData>("/api/dev/jobs/summary");
  const failureItems = useMemo(() => Object.entries(data?.summary.failures ?? {}), [data]);

  if (loading) {
    return <SectionLoader text="Loading..." />;
  }
  if (!data) {
    return <div className="rounded-2xl bg-white p-6 text-sm text-red-600 shadow-sm">{error ?? "Failed to load jobs summary."}</div>;
  }

  return (
    <div className="space-y-6">
      <DevKpiStrip
        items={[
          { label: "Queued emails", value: data.summary.queuedEmails },
          { label: "Failed emails", value: data.summary.failedEmails, tone: "danger" },
          { label: "Failed jobs (24h)", value: data.summary.failedJobs24h, tone: "warning" },
        ]}
      />

      <DevCard title="Failure Breakdown" subtitle="Derived from queue state and error-log correlation.">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {failureItems.map(([key, value]) => (
            <div key={key} className="rounded-xl border border-gray-100 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">{key}</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
            </div>
          ))}
        </div>
      </DevCard>
    </div>
  );
}
