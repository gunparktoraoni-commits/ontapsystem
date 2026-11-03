"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { InlineLoader, SectionLoader } from "@/app/components/Loader";
import { DevCard } from "@/app/dev/components/DevCard";
import { DevKpiStrip } from "@/app/dev/components/DevKpiStrip";
import { useDevEndpoint } from "@/app/dev/hooks/useDevEndpoint";

type IncidentRow = {
  id: string;
  title: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  status: string;
  occurrences: number;
  affectedUsers: number;
  affectedCompanies: number;
  lastSeenAt: string;
};

type IncidentsResponse = {
  items: IncidentRow[];
  summary: { total: number; critical: number; high: number; medium: number; low: number };
};

type IncidentDetail = {
  incident: IncidentRow | null;
  samples: Array<{ id: string; message: string; source: string; createdAt: string; userId: string | null }>;
  relatedUsers: Array<{ userId: string; name: string; email: string; companyId: string | null }>;
  relatedEscalations: Array<{ id: string; status: string; preview: string | null }>;
};

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

export default function DevIncidentsPage() {
  const searchParams = useSearchParams();
  const selectedQuery = searchParams.get("incidentId");
  const { data, loading, error } = useDevEndpoint<IncidentsResponse>("/api/dev/incidents");
  const [selectedId, setSelectedId] = useState<string | null>(selectedQuery);
  const { data: detail, loading: detailLoading } = useDevEndpoint<IncidentDetail>(
    selectedId ? `/api/dev/incidents/${encodeURIComponent(selectedId)}` : null,
    [selectedId],
  );

  useEffect(() => {
    if (selectedQuery) setSelectedId(selectedQuery);
  }, [selectedQuery]);

  const summaryItems = useMemo(
    () =>
      data
        ? [
            { label: "Grouped incidents", value: data.summary.total },
            { label: "Critical", value: data.summary.critical, tone: "danger" as const },
            { label: "High", value: data.summary.high, tone: "warning" as const },
            { label: "Medium", value: data.summary.medium },
          ]
        : [],
    [data],
  );

  if (loading) {
    return <SectionLoader text="Loading incidents..." />;
  }

  if (!data) {
    return <div className="rounded-2xl bg-white p-6 text-sm text-red-600 shadow-sm">{error ?? "Failed to load incidents."}</div>;
  }

  return (
    <div className="space-y-6">
      <DevKpiStrip items={summaryItems} />

      <div className="grid gap-6 xl:grid-cols-[1.4fr,0.9fr]">
        <DevCard title="Incident Queue" subtitle="Grouped incidents derived from raw system error telemetry.">
          <div className="space-y-3">
            {data.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                  selectedId === item.id ? "border-[#2A4792] bg-[#EEF2FA]" : "border-gray-100 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {item.id} · {item.status} · {item.occurrences} occurrences
                    </p>
                    <p className="mt-2 text-xs text-gray-600">
                      {item.affectedUsers} users · {item.affectedCompanies} companies · last seen {formatDate(item.lastSeenAt)}
                    </p>
                  </div>
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">{item.severity}</span>
                </div>
              </button>
            ))}
          </div>
        </DevCard>

        <DevCard title="Incident Detail" subtitle="Sample errors and correlated business context.">
          {!selectedId ? (
            <p className="text-sm text-gray-500">Select an incident to inspect its sample errors, users, and escalations.</p>
          ) : detailLoading ? (
            <div className="flex min-h-[240px] items-center justify-center">
              <InlineLoader />
            </div>
          ) : !detail ? (
            <p className="text-sm text-gray-500">No detail is available for this incident yet.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-gray-900">{detail.incident?.title ?? selectedId}</p>
                <p className="mt-1 text-xs text-gray-500">{detail.incident?.status ?? "open"} · {detail.incident?.severity ?? "Medium"}</p>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Sample errors</p>
                <div className="space-y-2">
                  {detail.samples.slice(0, 5).map((sample) => (
                    <div key={sample.id} className="rounded-xl border border-gray-100 px-3 py-2">
                      <p className="text-sm font-medium text-gray-800">{sample.message}</p>
                      <p className="mt-1 text-xs text-gray-500">{sample.source} · {formatDate(sample.createdAt)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Related users</p>
                <div className="space-y-2">
                  {detail.relatedUsers.length === 0 ? (
                    <p className="text-sm text-gray-500">No directly linked users.</p>
                  ) : (
                    detail.relatedUsers.slice(0, 5).map((user) => (
                      <div key={user.userId} className="rounded-xl border border-gray-100 px-3 py-2">
                        <p className="text-sm font-medium text-gray-800">{user.name || user.email}</p>
                        <p className="mt-1 text-xs text-gray-500">{user.email}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Linked escalations</p>
                <div className="space-y-2">
                  {detail.relatedEscalations.length === 0 ? (
                    <p className="text-sm text-gray-500">No escalations were correlated from the current telemetry.</p>
                  ) : (
                    detail.relatedEscalations.map((row) => (
                      <div key={row.id} className="rounded-xl border border-gray-100 px-3 py-2">
                        <p className="text-sm font-medium text-gray-800">Conversation {row.id}</p>
                        <p className="mt-1 text-xs text-gray-500">{row.status} · {row.preview ?? "Escalated support conversation"}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </DevCard>
      </div>
    </div>
  );
}
