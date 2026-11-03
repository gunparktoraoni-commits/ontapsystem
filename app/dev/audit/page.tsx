"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { InlineLoader, SectionLoader } from "@/app/components/Loader";
import { DevCard } from "@/app/dev/components/DevCard";
import { useDevEndpoint } from "@/app/dev/hooks/useDevEndpoint";

type AuditTimeline = {
  items: Array<{
    id: string;
    type: string;
    label: string;
    target: string;
    detail: string | null;
    severity: string | null;
    actorUserId: string | null;
    createdAt: string;
    source: string;
  }>;
  focusedEventId: string | null;
};

function severityChip(severity: string | null) {
  if (!severity) return null;
  const value = severity.toLowerCase();
  const cls =
    value === "critical"
      ? "bg-red-50 text-red-700 border-red-200"
      : value === "warning"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize ${cls}`}>
      {severity}
    </span>
  );
}

export default function DevAuditPage() {
  const searchParams = useSearchParams();
  const focusEvent = searchParams.get("event");
  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", focusEvent ? "80" : "40");
    if (focusEvent) params.set("event", focusEvent);
    return `/api/dev/audit/timeline?${params.toString()}`;
  }, [focusEvent]);

  const { data, loading, error } = useDevEndpoint<AuditTimeline>(query, [query]);
  const focusedRef = useRef<HTMLDivElement | null>(null);
  const focusedId = data?.focusedEventId ?? focusEvent;

  useEffect(() => {
    if (!focusedId || !data) return;
    const timer = window.setTimeout(() => {
      focusedRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [focusedId, data]);

  if (loading) {
    return (
      <SectionLoader text="Loading..." />
    );
  }
  if (!data) {
    return (
      <div className="rounded-2xl bg-white p-6 text-sm text-red-600 shadow-sm">
        {error ?? "Failed to load audit timeline."}
      </div>
    );
  }

  return (
    <DevCard
      title="Audit Timeline"
      subtitle="Merged platform audit stream including security alerts. Open an alert from System Health to jump here."
    >
      {focusedId ? (
        <div className="mb-4 rounded-xl border border-[#2A4792]/20 bg-[#EEF2FA] px-4 py-3 text-sm text-[#2A4792]">
          Focused on event <code className="font-mono text-xs">{focusedId}</code>
          {!data.items.some((item) => item.id === focusedId)
            ? " — record not found in the current feed."
            : " — highlighted below with full detail."}
        </div>
      ) : null}

      <div className="space-y-3">
        {data.items.length === 0 ? (
          <p className="text-sm text-gray-500">No audit events found.</p>
        ) : (
          data.items.map((item) => {
            const isFocused = item.id === focusedId;
            return (
              <div
                key={item.id}
                id={`audit-event-${encodeURIComponent(item.id)}`}
                ref={isFocused ? focusedRef : undefined}
                className={`rounded-xl border px-4 py-3 transition-shadow ${
                  isFocused
                    ? "border-[#2A4792] bg-[#EEF2FA]/50 ring-2 ring-[#2A4792]/20"
                    : "border-gray-100 bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">{item.label}</p>
                      {severityChip(item.severity)}
                      {(item.type === "security_alert" || item.type === "security_audit") && (
                        <span className="rounded-full bg-purple-50 border border-purple-200 px-2 py-0.5 text-[11px] font-semibold text-purple-700">
                          security
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-600">{item.target}</p>
                    {item.detail ? (
                      <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-white/80 px-3 py-2 text-xs text-gray-600 border border-gray-100">
                        {item.detail}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-gray-500">
                      {item.type} · {item.source} · actor {item.actorUserId ?? "system"} ·{" "}
                      <span className="font-mono">{item.id}</span>
                    </p>
                  </div>
                  <p className="shrink-0 text-xs text-gray-500">
                    {new Date(item.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </DevCard>
  );
}
