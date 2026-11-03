"use client";

import React from "react";
import Link from "next/link";
import { InlineLoader, SectionLoader } from "@/app/components/Loader";
import { DevCard } from "@/app/dev/components/DevCard";
import { DevKpiStrip } from "@/app/dev/components/DevKpiStrip";
import { useDevEndpoint } from "@/app/dev/hooks/useDevEndpoint";

type OverviewData = {
  summary: {
    openIncidents: number;
    criticalIncidents: number;
    openEscalations: number;
    affectedUsers24h: number;
    authSuccessRate24h: number;
    failedJobs24h: number;
    activeUsers: number;
  };
  incidents: Array<{ id: string; title: string; severity: string; status: string; occurrences: number }>;
  escalations: Array<{ id: string; clientName: string; status: string; preview: string | null; escalatedAt: string | null }>;
  auth: { successRate24h: number; attempts24h: number; failures24h: number; activeSessions: number; topFailureReason: string };
  jobs: { queuedEmails: number; failedEmails: number; failedJobs24h: number };
  timeline: Array<{ id: string; label: string; target: string; createdAt: string }>;
};
function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}
export default function DevOverviewPage() {
  const { data, loading, error } = useDevEndpoint<OverviewData>("/api/dev/overview");
  if (loading) {
    return <SectionLoader text="Loading overview..." />;
  }

  if (!data) {
    return <div className="rounded-2xl bg-white p-6 text-sm text-red-600 shadow-sm">{error ?? "Failed to load overview."}</div>;
  }

  return (
    <div className="space-y-6">
      <DevKpiStrip
        items={[
          { label: "Open incidents", value: data.summary.openIncidents, tone: "danger" },
          { label: "Critical incidents", value: data.summary.criticalIncidents, tone: "danger" },
          { label: "Open escalations", value: data.summary.openEscalations, tone: "warning" },
          { label: "Affected users", value: data.summary.affectedUsers24h },
          { label: "Auth success rate", value: `${data.summary.authSuccessRate24h}%`, tone: "success" },
          { label: "Failed jobs", value: data.summary.failedJobs24h, tone: "warning" },
          { label: "Active users", value: data.summary.activeUsers },
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <DevCard title="Active Incidents" subtitle="Highest-severity grouped failures across the platform.">  
          <div className="space-y-3">
            {data.incidents.map((item) => (
              <Link key={item.id} href={`/dev/incidents?incidentId=${encodeURIComponent(item.id)}`} className="block rounded-xl border border-gray-100 px-4 py-3 hover:bg-gray-50">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {item.id} · {item.status} · {item.occurrences} occurrences
                    </p>
                  </div>
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">{item.severity}</span>
                </div>
              </Link>
            ))}
          </div>
        </DevCard>

        <DevCard title="Escalation Queue" subtitle="Recent escalated conversations that may need engineering action.">
          <div className="space-y-3">
            {data.escalations.map((item) => (
              <Link key={item.id} href="/dev/escalations" className="block rounded-xl border border-gray-100 px-4 py-3 hover:bg-gray-50">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{item.clientName}</p>
                    <p className="mt-1 text-sm text-gray-600">{item.preview ?? "Escalated support conversation"}</p>
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    <p>{item.status}</p>
                    <p className="mt-1">{formatDateTime(item.escalatedAt)}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </DevCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <DevCard title="Auth Health" subtitle="Login quality and session posture from current telemetry.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-gray-50 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">Attempts (24h)</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">{data.auth.attempts24h}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">Failures (24h)</p>
              <p className="mt-2 text-2xl font-bold text-red-600">{data.auth.failures24h}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">Active sessions</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">{data.auth.activeSessions}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">Top failure reason</p>
              <p className="mt-2 text-sm font-semibold text-gray-900">{data.auth.topFailureReason}</p>
            </div>
          </div>
        </DevCard>

        <DevCard title="Jobs & Integrations" subtitle="Operational pressure from queues and pipeline failures.">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl bg-gray-50 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">Queued emails</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">{data.jobs.queuedEmails}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">Failed emails</p>
              <p className="mt-2 text-2xl font-bold text-red-600">{data.jobs.failedEmails}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">Failed jobs (24h)</p>
              <p className="mt-2 text-2xl font-bold text-amber-600">{data.jobs.failedJobs24h}</p>
            </div>
          </div>
        </DevCard>
      </div>

      <DevCard title="Recent Audit Timeline" subtitle="Cross-domain operational changes and risky events.">
        <div className="space-y-3">
          {data.timeline.map((item) => (
            <div key={item.id} className="rounded-xl border border-gray-100 px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{item.label}</p>
                  <p className="mt-1 text-sm text-gray-600">{item.target}</p>
                </div>
                <p className="text-xs text-gray-500">{formatDateTime(item.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>
      </DevCard>
    </div>
  );
}
