"use client";

import React from "react";
import { InlineLoader, SectionLoader } from "@/app/components/Loader";
import { DevCard } from "@/app/dev/components/DevCard";
import { DevKpiStrip } from "@/app/dev/components/DevKpiStrip";
import { useDevEndpoint } from "@/app/dev/hooks/useDevEndpoint";

type ImpactSummary = {
  summary: { incidentCount: number; totalAffectedUsers: number; totalAffectedCompanies: number };
  hotspots: Array<{ id: string; title: string; affectedUsers: number; affectedCompanies: number; severity: string }>;
};

export default function DevImpactPage() {
  const { data, loading, error } = useDevEndpoint<ImpactSummary>("/api/dev/impact/summary");

  if (loading) {
    return <SectionLoader text="Loading..." />;
  }
  if (!data) {
    return <div className="rounded-2xl bg-white p-6 text-sm text-red-600 shadow-sm">{error ?? "Failed to load impact summary."}</div>;
  }

  return (
    <div className="space-y-6">
      <DevKpiStrip
        items={[
          { label: "Incident groups", value: data.summary.incidentCount },
          { label: "Affected users", value: data.summary.totalAffectedUsers, tone: "warning" },
          { label: "Affected companies", value: data.summary.totalAffectedCompanies, tone: "warning" },
        ]}
      />

      <DevCard title="Impact Hotspots" subtitle="Incidents sorted by likely business impact.">
        <div className="space-y-3">
          {data.hotspots.map((item) => (
            <div key={item.id} className="rounded-xl border border-gray-100 px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                  <p className="mt-1 text-xs text-gray-500">{item.id} · {item.severity}</p>
                </div>
                <div className="text-right text-xs text-gray-600">
                  <p>{item.affectedUsers} users</p>
                  <p className="mt-1">{item.affectedCompanies} companies</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </DevCard>
    </div>
  );
}
