"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { LogOut, ShieldBan, X } from "lucide-react";
import { InlineLoader, SectionLoader } from "@/app/components/Loader";
import { ModalPortal } from "@/app/components/ModalPortal";
import { DevCard } from "@/app/dev/components/DevCard";
import { DevKpiStrip } from "@/app/dev/components/DevKpiStrip";
import { devApiJson } from "@/app/dev/lib/devApi";
import type { AuthLoginMapPoint } from "./AuthLoginMap";
import { IntegritySection } from "./IntegritySection";

const AuthLoginMap = dynamic(
  () => import("./AuthLoginMap").then((mod) => mod.AuthLoginMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[360px] items-center justify-center rounded-2xl bg-slate-50 text-sm text-slate-500">
        Loading map…
      </div>
    ),
  },
);

type DatePreset = "today" | "week" | "month" | "custom";
type ListTab = "failures" | "attempts" | "sessions";
type PageSection = "auth" | "integrity";

type AuthDashboard = {
  range: { preset: DatePreset; from: string; to: string };
  summary: {
    successRate: number;
    attempts: number;
    failures: number;
    auditFailures: number;
    activeSessions: number;
    mappedLogins: number;
    topFailureReason: string;
  };
  mapPoints: AuthLoginMapPoint[];
  failures: Array<{
    action: string;
    createdAt: string;
    email: string | null;
    ipAddress: string | null;
  }>;
  attempts: Array<{
    email: string;
    success: boolean;
    ipAddress: string | null;
    createdAt: string;
  }>;
  sessions: Array<{
    sessionId: string;
    userId: string;
    email: string;
    name: string;
    role: string;
    bizcardCount: number;
    companyName: string | null;
    isRestricted: boolean;
    deviceType: string | null;
    browser: string | null;
    os: string | null;
    ipAddress: string | null;
    location: string | null;
    createdAt: string;
    lastActivity: string | null;
  }>;
};

type ConfirmAction = "logout" | "restrict" | null;

const PRESETS: Array<{ id: DatePreset; label: string }> = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "custom", label: "Custom" },
];

function toDateInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function DevAuthHealthPage() {
  const [section, setSection] = useState<PageSection>(() => {
    if (typeof window === "undefined") return "auth";
    const params = new URLSearchParams(window.location.search);
    return params.get("section") === "integrity" ? "integrity" : "auth";
  });
  const [preset, setPreset] = useState<DatePreset>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<AuthDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ListTab>("failures");
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [restrictReason, setRestrictReason] = useState("Suspicious activity / Auth Health review");
  const [durationDays, setDurationDays] = useState<string>("");
  const [acting, setActing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const queryPath = useMemo(() => {
    const params = new URLSearchParams();
    params.set("range", preset);
    if (preset === "custom") {
      if (customFrom) params.set("from", customFrom);
      if (customTo) params.set("to", customTo);
    }
    return `/api/dev/auth/summary?${params.toString()}`;
  }, [preset, customFrom, customTo]);

  const load = useCallback(async () => {
    if (preset === "custom" && (!customFrom || !customTo)) {
      setError("Choose both start and end dates for a custom range.");
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await devApiJson<AuthDashboard>(queryPath, { method: "GET" });
      if (!result.ok || !result.data) {
        throw new Error(result.error ?? "Failed to load auth health.");
      }
      setData(result.data);
      setSelectedUserIds(new Set());
      if (!customFrom && result.data.range.from) {
        setCustomFrom(toDateInputValue(result.data.range.from));
      }
      if (!customTo && result.data.range.to) {
        setCustomTo(toDateInputValue(result.data.range.to));
      }
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Failed to load auth health.");
    } finally {
      setLoading(false);
    }
  }, [queryPath, preset, customFrom, customTo]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleUser = (userId: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const selectedCount = selectedUserIds.size;

  const runAction = async () => {
    if (!confirmAction || !selectedCount) return;
    setActing(true);
    setNotice(null);
    try {
      const result = await devApiJson("/api/dev/auth/actions", {
        method: "POST",
        body: {
          action: confirmAction,
          userIds: Array.from(selectedUserIds),
          reason: restrictReason,
          durationDays: durationDays.trim() ? Number(durationDays) : null,
        },
      });
      if (!result.ok) throw new Error(result.error ?? "Action failed.");
      setNotice(
        confirmAction === "logout"
          ? `Logged out ${selectedCount} user${selectedCount === 1 ? "" : "s"}.`
          : `Restricted login for ${selectedCount} user${selectedCount === 1 ? "" : "s"}.`,
      );
      setConfirmAction(null);
      setSelectedUserIds(new Set());
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setActing(false);
    }
  };

  if (section === "auth" && loading && !data) {
    return <SectionLoader text="Loading auth health..." />;
  }

  if (section === "auth" && !data && error) {
    return (
      <div className="rounded-2xl bg-white p-6 text-sm text-red-600 shadow-sm">{error}</div>
    );
  }

  if (section === "auth" && !data) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Auth Health</h1>
            <p className="mt-1 text-sm text-slate-500">
              Login geography, session controls, and platform integrity checks in one place.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["auth", "Auth & sessions"],
                ["integrity", "Integrity"],
              ] as Array<[PageSection, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setSection(id);
                  if (typeof window !== "undefined") {
                    const url = new URL(window.location.href);
                    if (id === "integrity") url.searchParams.set("section", "integrity");
                    else url.searchParams.delete("section");
                    window.history.replaceState({}, "", url.toString());
                  }
                }}
                className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                  section === id
                    ? "bg-[#2A4792] text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {section === "auth" ? (
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
            {PRESETS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setPreset(item.id)}
                className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                  preset === item.id
                    ? "bg-[#2A4792] text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {item.label}
              </button>
            ))}
            {preset === "custom" ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                  className="rounded-xl border border-slate-200 px-2.5 py-2 text-xs"
                />
                <span className="text-xs text-slate-400">to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(event) => setCustomTo(event.target.value)}
                  className="rounded-xl border border-slate-200 px-2.5 py-2 text-xs"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {section === "integrity" ? <IntegritySection /> : null}

      {section === "auth" && data ? (
        <>
      {notice ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <DevKpiStrip
        items={[
          { label: "Success rate", value: `${data.summary.successRate}%`, tone: "success" },
          { label: "Attempts", value: data.summary.attempts },
          { label: "Failures", value: data.summary.failures, tone: "danger" },
          { label: "Active sessions", value: data.summary.activeSessions },
        ]}
      />

      <DevCard
        title="Recent logins map"
        subtitle={`${data.summary.mappedLogins} geolocated login${data.summary.mappedLogins === 1 ? "" : "s"} in range · top failure: ${data.summary.topFailureReason}`}
      >
        <AuthLoginMap points={data.mapPoints} />
      </DevCard>

      <DevCard
        title="Auth activity"
        subtitle="Failures follow the date filter. Switch tabs for attempts and live sessions."
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["failures", `Failures (${data.failures.length})`],
                ["attempts", `Attempts (${data.attempts.length})`],
                ["sessions", `Active sessions (${data.sessions.length})`],
              ] as Array<[ListTab, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`rounded-xl px-3 py-2 text-xs font-semibold ${
                  tab === id
                    ? "bg-[#2A4792] text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "sessions" ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!selectedCount}
                onClick={() => setConfirmAction("logout")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 disabled:opacity-50"
              >
                <LogOut className="h-3.5 w-3.5" />
                Log out selected ({selectedCount})
              </button>
              <button
                type="button"
                disabled={!selectedCount}
                onClick={() => setConfirmAction("restrict")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50"
              >
                <ShieldBan className="h-3.5 w-3.5" />
                Restrict login
              </button>
            </div>
          ) : null}
        </div>

        {tab === "failures" ? (
          <div className="max-h-[420px] space-y-2 overflow-y-auto">
            {data.failures.length === 0 ? (
              <p className="text-sm text-slate-500">No failures in this date range.</p>
            ) : (
              data.failures.map((item, index) => (
                <div
                  key={`${item.action}-${item.createdAt}-${index}`}
                  className="rounded-xl border border-slate-100 px-4 py-3"
                >
                  <p className="text-sm font-semibold text-slate-900">{item.action}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.email ?? "Unknown email"}
                    {item.ipAddress ? ` · ${item.ipAddress}` : ""}
                    {" · "}
                    {new Date(item.createdAt).toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </div>
        ) : null}

        {tab === "attempts" ? (
          <div className="max-h-[420px] space-y-2 overflow-y-auto">
            {data.attempts.length === 0 ? (
              <p className="text-sm text-slate-500">No attempts in this date range.</p>
            ) : (
              data.attempts.map((item, index) => (
                <div
                  key={`${item.email}-${item.createdAt}-${index}`}
                  className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{item.email}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.ipAddress ?? "No IP"} · {new Date(item.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                      item.success
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-rose-50 text-rose-700"
                    }`}
                  >
                    {item.success ? "Success" : "Failed"}
                  </span>
                </div>
              ))
            )}
          </div>
        ) : null}

        {tab === "sessions" ? (
          <div className="max-h-[480px] space-y-2 overflow-y-auto">
            {data.sessions.length === 0 ? (
              <p className="text-sm text-slate-500">No active sessions right now.</p>
            ) : (
              Object.values(
                data.sessions.reduce<
                  Record<
                    string,
                    {
                      userId: string;
                      email: string;
                      name: string;
                      role: string;
                      bizcardCount: number;
                      companyName: string | null;
                      isRestricted: boolean;
                      sessionCount: number;
                      latestActivity: string | null;
                      sample: (typeof data.sessions)[number];
                    }
                  >
                >((acc, session) => {
                  const existing = acc[session.userId];
                  if (!existing) {
                    acc[session.userId] = {
                      userId: session.userId,
                      email: session.email,
                      name: session.name,
                      role: session.role,
                      bizcardCount: session.bizcardCount,
                      companyName: session.companyName,
                      isRestricted: session.isRestricted,
                      sessionCount: 1,
                      latestActivity: session.lastActivity,
                      sample: session,
                    };
                  } else {
                    existing.sessionCount += 1;
                    if (
                      session.lastActivity &&
                      (!existing.latestActivity ||
                        session.lastActivity > existing.latestActivity)
                    ) {
                      existing.latestActivity = session.lastActivity;
                      existing.sample = session;
                    }
                  }
                  return acc;
                }, {}),
              ).map((row) => {
                const checked = selectedUserIds.has(row.userId);
                const session = row.sample;
                return (
                  <label
                    key={row.userId}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 ${
                      checked ? "border-[#2A4792]/40 bg-[#2A4792]/5" : "border-slate-100 bg-white"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleUser(row.userId)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-[#2A4792] focus:ring-[#2A4792]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">{row.email}</p>
                        {row.isRestricted ? (
                          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700">
                            Restricted
                          </span>
                        ) : null}
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                          {row.sessionCount} session{row.sessionCount === 1 ? "" : "s"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {row.name} · {row.role} · {row.bizcardCount} bizcard
                        {row.bizcardCount === 1 ? "" : "s"}
                        {row.companyName ? ` · ${row.companyName}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {[session.deviceType, session.browser, session.os].filter(Boolean).join(" · ") ||
                          "Unknown device"}
                        {session.location ? ` · ${session.location}` : ""}
                        {session.ipAddress ? ` · ${session.ipAddress}` : ""}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        Last active{" "}
                        {row.latestActivity
                          ? new Date(row.latestActivity).toLocaleString()
                          : "—"}
                      </p>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        ) : null}
      </DevCard>

      <ModalPortal isOpen={Boolean(confirmAction)} onClose={() => !acting && setConfirmAction(null)}>
        <div className="mx-4 w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {confirmAction === "logout" ? "Force log out users?" : "Restrict login access?"}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {selectedCount} selected user{selectedCount === 1 ? "" : "s"}
              </p>
            </div>
            <button
              type="button"
              disabled={acting}
              onClick={() => setConfirmAction(null)}
              className="rounded-full p-2 text-slate-400 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3 px-5 py-4 text-sm text-slate-600">
            {confirmAction === "logout" ? (
              <p>
                This immediately ends all active sessions for the selected users. They will need to
                sign in again.
              </p>
            ) : (
              <>
                <p>
                  Selected users will be logged out and blocked from signing in until the restriction
                  ends (or indefinitely if no duration is set).
                </p>
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">Reason</span>
                  <input
                    value={restrictReason}
                    onChange={(event) => setRestrictReason(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">
                    Duration in days{" "}
                    <span className="font-normal text-slate-400">(blank = indefinite)</span>
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={durationDays}
                    onChange={(event) => setDurationDays(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    placeholder="e.g. 7"
                  />
                </label>
              </>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-4">
            <button
              type="button"
              disabled={acting}
              onClick={() => setConfirmAction(null)}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={acting}
              onClick={() => void runAction()}
              className={`rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
                confirmAction === "restrict"
                  ? "bg-rose-600 hover:bg-rose-700"
                  : "bg-amber-600 hover:bg-amber-700"
              }`}
            >
              {acting
                ? "Working…"
                : confirmAction === "restrict"
                  ? "Confirm restrict"
                  : "Confirm log out"}
            </button>
          </div>
        </div>
      </ModalPortal>
        </>
      ) : null}
    </div>
  );
}
