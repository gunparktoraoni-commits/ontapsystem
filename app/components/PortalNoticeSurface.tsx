"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Megaphone,
  MinusCircle,
  PlusCircle,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { csrfClient } from "@/lib/csrf-client";
import type { NoticePlacementId, NoticePortalId, SurveyQuestion } from "@/lib/portal/notice-board";

const API = getFrontendApiBaseUrl();
const DISMISS_KEY = "ontap:notice-dismissed";

type SurfaceNotice = {
  publicId: string;
  title: string;
  summary: string | null;
  body: string;
  noticeType: string;
  noticeTypeLabel: string;
  priority: string;
  accentColor: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  surveyUrl: string | null;
  whatsNewAdded?: string[];
  whatsNewFixed?: string[];
  whatsNewRemoved?: string[];
  surveyQuestions?: SurveyQuestion[];
  mediaUrls?: string[];
};

function readDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(DISMISS_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: Set<string>) {
  sessionStorage.setItem(DISMISS_KEY, JSON.stringify(Array.from(ids)));
}

function TypeIcon({ type }: { type: string }) {
  if (type === "system_update") return <Wrench className="h-4 w-4" />;
  if (type === "promotion") return <Megaphone className="h-4 w-4" />;
  return <Sparkles className="h-4 w-4" />;
}

function ChangelogBlock({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "added" | "fixed" | "removed";
}) {
  if (!items.length) return null;
  const styles = {
    added: { bg: "bg-emerald-50", text: "text-emerald-800", icon: PlusCircle },
    fixed: { bg: "bg-sky-50", text: "text-sky-800", icon: CheckCircle2 },
    removed: { bg: "bg-rose-50", text: "text-rose-800", icon: MinusCircle },
  }[tone];
  const Icon = styles.icon;
  return (
    <div className={`rounded-xl ${styles.bg} px-3 py-2`}>
      <p className={`mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide ${styles.text}`}>
        <Icon className="h-3 w-3" />
        {title}
      </p>
      <ul className={`space-y-1 text-xs ${styles.text}`}>
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}

function SurveyForm({ notice }: { notice: SurfaceNotice }) {
  const questions = notice.surveyQuestions ?? [];
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(
          `${API}/api/portal/notices/${encodeURIComponent(notice.publicId)}/survey`,
          { credentials: "include", cache: "no-store" },
        );
        const payload = await res.json().catch(() => ({}));
        if (!cancelled && payload?.data?.answered) {
          setDone(true);
        }
      } catch {
        // ignore
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [notice.publicId]);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const token = await csrfClient.getToken(false, API || undefined);
      const headers = csrfClient.buildHeaders(token);
      headers.set("Content-Type", "application/json");
      let response = await fetch(
        `${API}/api/portal/notices/${encodeURIComponent(notice.publicId)}/survey`,
        {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({ answers }),
        },
      );
      if (response.status === 403) {
        const payload = await response.clone().json().catch(() => ({}));
        if (payload?.code === "CSRF_TOKEN_INVALID") {
          const fresh = await csrfClient.getToken(true, API || undefined);
          const retryHeaders = csrfClient.buildHeaders(fresh);
          retryHeaders.set("Content-Type", "application/json");
          response = await fetch(
            `${API}/api/portal/notices/${encodeURIComponent(notice.publicId)}/survey`,
            {
              method: "POST",
              credentials: "include",
              headers: retryHeaders,
              body: JSON.stringify({ answers }),
            },
          );
        }
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error ?? "Could not submit survey.");
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit survey.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
        Thanks — your response was recorded.
      </p>
    );
  }

  if (!questions.length) {
    if (notice.surveyUrl) {
      return (
        <a
          href={notice.surveyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:underline"
        >
          Open survey
          <ArrowRight className="h-3 w-3" />
        </a>
      );
    }
    return null;
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-violet-100 bg-violet-50/40 p-3">
      {questions.map((question, index) => (
        <fieldset key={question.id} className="space-y-1.5">
          <legend className="text-xs font-semibold text-slate-800">
            {index + 1}. {question.prompt}
            {question.required ? <span className="text-rose-500"> *</span> : null}
          </legend>

          {question.type === "single" || question.type === "yes_no" ? (
            <div className="space-y-1">
              {(question.type === "yes_no" ? ["Yes", "No"] : question.options ?? []).map((option) => {
                const value = question.type === "yes_no" ? option.toLowerCase() : option;
                return (
                  <label key={option} className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="radio"
                      name={question.id}
                      checked={answers[question.id] === value}
                      onChange={() =>
                        setAnswers((prev) => ({ ...prev, [question.id]: value }))
                      }
                      className="text-violet-700 focus:ring-violet-500"
                    />
                    {option}
                  </label>
                );
              })}
            </div>
          ) : null}

          {question.type === "multiple" ? (
            <div className="space-y-1">
              {(question.options ?? []).map((option) => {
                const selected = Array.isArray(answers[question.id])
                  ? (answers[question.id] as string[]).includes(option)
                  : false;
                return (
                  <label key={option} className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => {
                        setAnswers((prev) => {
                          const current = Array.isArray(prev[question.id])
                            ? ([...(prev[question.id] as string[])] as string[])
                            : [];
                          const next = selected
                            ? current.filter((item) => item !== option)
                            : [...current, option];
                          return { ...prev, [question.id]: next };
                        });
                      }}
                      className="rounded text-violet-700 focus:ring-violet-500"
                    />
                    {option}
                  </label>
                );
              })}
            </div>
          ) : null}

          {question.type === "rating" ? (
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setAnswers((prev) => ({ ...prev, [question.id]: n }))}
                  className={`h-8 w-8 rounded-lg text-xs font-bold transition ${
                    answers[question.id] === n
                      ? "bg-violet-600 text-white"
                      : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-violet-50"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          ) : null}

          {question.type === "text" ? (
            <input
              value={typeof answers[question.id] === "string" ? String(answers[question.id]) : ""}
              onChange={(event) =>
                setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))
              }
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200"
              placeholder="Your answer"
            />
          ) : null}
        </fieldset>
      ))}

      {error ? <p className="text-xs text-rose-600">{error}</p> : null}

      <button
        type="button"
        disabled={submitting}
        onClick={() => void submit()}
        className="rounded-lg bg-violet-700 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-800 disabled:opacity-60"
      >
        {submitting ? "Submitting…" : "Submit responses"}
      </button>

      {notice.surveyUrl ? (
        <a
          href={notice.surveyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-[11px] font-semibold text-violet-700 hover:underline"
        >
          Prefer the external form instead →
        </a>
      ) : null}
    </div>
  );
}

export function PortalNoticeSurface({
  portal,
  placement,
  className = "",
  limit = 3,
}: {
  portal: NoticePortalId;
  placement: NoticePlacementId;
  className?: string;
  limit?: number;
}) {
  const [notices, setNotices] = useState<SurfaceNotice[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(
          `${API}/api/portal/notices?portal=${encodeURIComponent(portal)}&placement=${encodeURIComponent(placement)}`,
          { credentials: "include", cache: "no-store" },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) return;
        if (!cancelled) {
          setNotices(Array.isArray(payload.data?.notices) ? payload.data.notices : []);
        }
      } catch {
        // ignore
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [portal, placement]);

  const visible = useMemo(
    () => notices.filter((notice) => !dismissed.has(notice.publicId)).slice(0, limit),
    [notices, dismissed, limit],
  );

  if (visible.length === 0) return null;

  const dismiss = (id: string) => {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    writeDismissed(next);
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {visible.map((notice) => {
        const href =
          notice.noticeType === "survey"
            ? undefined
            : notice.ctaUrl || notice.surveyUrl || undefined;
        const isWhatsNew = notice.noticeType === "whats_new";
        return (
          <article
            key={notice.publicId}
            className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            style={{
              borderLeftWidth: 4,
              borderLeftColor: notice.accentColor ?? "#2A4792",
            }}
          >
            <button
              type="button"
              onClick={() => dismiss(notice.publicId)}
              className="absolute right-2 top-2 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Dismiss notice"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <div className="flex items-start gap-3 pr-6">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
                style={{ backgroundColor: notice.accentColor ?? "#2A4792" }}
              >
                <TypeIcon type={notice.noticeType} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  {notice.noticeTypeLabel}
                </p>
                <h3 className="mt-0.5 text-sm font-bold text-slate-900">{notice.title}</h3>
                <p className="mt-1 text-xs text-slate-600">
                  {notice.summary || (!isWhatsNew ? notice.body.slice(0, 180) : null)}
                </p>

                {isWhatsNew ? (
                  <div className="mt-3 space-y-2">
                    <ChangelogBlock title="Added" items={notice.whatsNewAdded ?? []} tone="added" />
                    <ChangelogBlock title="Fixed" items={notice.whatsNewFixed ?? []} tone="fixed" />
                    <ChangelogBlock
                      title="Removed"
                      items={notice.whatsNewRemoved ?? []}
                      tone="removed"
                    />
                  </div>
                ) : null}

                {notice.noticeType === "promotion" && (notice.mediaUrls?.length ?? 0) > 0 ? (
                  <div className="mt-3 flex gap-2 overflow-x-auto">
                    {notice.mediaUrls!.slice(0, 3).map((url) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={url}
                        src={url}
                        alt=""
                        className="h-20 w-28 shrink-0 rounded-lg object-cover ring-1 ring-slate-200"
                      />
                    ))}
                  </div>
                ) : null}

                {notice.noticeType === "survey" ? <SurveyForm notice={notice} /> : null}

                {href ? (
                  <a
                    href={href}
                    target={href.startsWith("http") ? "_blank" : undefined}
                    rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#2A4792] hover:underline"
                  >
                    {notice.ctaLabel || "Open"}
                    <ArrowRight className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
