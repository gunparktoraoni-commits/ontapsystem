"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Star, X } from "lucide-react";
import { ModalPortal } from "@/app/components/ModalPortal";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { InlineLoader } from "@/app/components/Loader";
import { showToast } from "@/app/components/Toast";
import { buildImpersonationHeaders } from "@/app/lib/superadminImpersonationHandoff";
import { csrfClient } from "@/lib/csrf-client";
import {
  EXPERIENCE_SURVEY_FEATURE_MAX_LENGTH,
  EXPERIENCE_SURVEY_FEEDBACK_MAX_LENGTH,
} from "@/lib/portal/experience-survey";

export const EXPERIENCE_SURVEY_PENDING_KEY = "ontap:experience-survey:pending";
export const EXPERIENCE_SURVEY_SESSION_DISMISS_KEY =
  "ontap:experience-survey:session-dismiss";

const SHOW_DELAY_MS = 900;

const RATING_LABELS: Record<number, string> = {
  1: "Very difficult",
  2: "Difficult",
  3: "Okay",
  4: "Good",
  5: "Excellent",
};

function readExperienceSurveyPending(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(EXPERIENCE_SURVEY_PENDING_KEY) === "1";
  } catch {
    return false;
  }
}

function clearExperienceSurveyPending(): void {
  try {
    window.localStorage.removeItem(EXPERIENCE_SURVEY_PENDING_KEY);
  } catch {
    // ignore storage errors
  }
}

export function markExperienceSurveyPending(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EXPERIENCE_SURVEY_PENDING_KEY, "1");
  } catch {
    // ignore storage errors
  }
}

function readSessionDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(EXPERIENCE_SURVEY_SESSION_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function persistSessionDismissed(): void {
  try {
    window.sessionStorage.setItem(EXPERIENCE_SURVEY_SESSION_DISMISS_KEY, "1");
  } catch {
    // ignore storage errors
  }
}

function parseApiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  const nested = record.error;
  if (nested && typeof nested === "object") {
    const message = String((nested as Record<string, unknown>).message ?? "").trim();
    if (message) return message;
  }
  const direct = String(record.error ?? record.message ?? "").trim();
  return direct || fallback;
}

type UserExperienceSurveyModalProps = {
  enabled?: boolean;
};

export function UserExperienceSurveyModal({
  enabled = true,
}: UserExperienceSurveyModalProps) {
  const API = getFrontendApiBaseUrl();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const [featureSuggestion, setFeatureSuggestion] = useState("");
  const [hoverRating, setHoverRating] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      setChecked(true);
      return;
    }

    if (readSessionDismissed() || !readExperienceSurveyPending()) {
      setChecked(true);
      return;
    }

    let cancelled = false;
    let delayTimer: number | undefined;

    const load = async () => {
      try {
        const res = await fetch(`${API}/api/user/experience-survey`, {
          credentials: "include",
          cache: "no-store",
          headers: buildImpersonationHeaders(),
        });
        if (!res.ok) return;
        const payload = await res.json().catch(() => null);
        const data = payload?.data ?? null;
        if (cancelled || !data?.eligible) {
          if (data?.eligible === false) {
            clearExperienceSurveyPending();
          }
          return;
        }

        delayTimer = window.setTimeout(() => {
          if (!cancelled) setOpen(true);
        }, SHOW_DELAY_MS);
      } catch {
        // Non-blocking — survey can be checked again on next portal entry.
      } finally {
        if (!cancelled) setChecked(true);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (delayTimer) window.clearTimeout(delayTimer);
    };
  }, [API, enabled]);

  const closeModal = useCallback(() => {
    setOpen(false);
  }, []);

  const dismissSurvey = useCallback(async () => {
    if (submitting) return;
    persistSessionDismissed();
    clearExperienceSurveyPending();
    setOpen(false);

    try {
      const options = await csrfClient.getFetchOptions("POST", { action: "dismiss" }, false, API);
      await fetch(`${API}/api/user/experience-survey`, {
        ...options,
        headers: {
          ...Object.fromEntries(new Headers(options.headers).entries()),
          ...buildImpersonationHeaders(),
        },
      });
    } catch {
      // Dismiss is still respected locally for this session.
    }
  }, [API, submitting]);

  const handleClose = useCallback(() => {
    void dismissSurvey();
  }, [dismissSurvey]);

  const handleSubmit = async () => {
    if (submitting) return;
    if (!rating) {
      setError("Please select a rating before submitting.");
      return;
    }

    setError("");
    setSubmitting(true);
    try {
      const options = await csrfClient.getFetchOptions(
        "POST",
        {
          action: "submit",
          rating,
          feedback: feedback.trim() || null,
          feature_suggestion: featureSuggestion.trim() || null,
        },
        false,
        API,
      );
      const res = await fetch(`${API}/api/user/experience-survey`, {
        ...options,
        headers: {
          ...Object.fromEntries(new Headers(options.headers).entries()),
          ...buildImpersonationHeaders(),
        },
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) {
        showToast(parseApiError(payload, "Unable to submit feedback. Please try again."), "error");
        return;
      }

      clearExperienceSurveyPending();
      persistSessionDismissed();
      setSuccess(true);
    } catch {
      showToast("Unable to submit feedback. Please try again.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const activeRating = hoverRating ?? rating;
  const displayRatingLabel = activeRating ? RATING_LABELS[activeRating] : null;

  if (!enabled || !checked) return null;

  return (
    <ModalPortal isOpen={open} onClose={handleClose}>
      <AnimatePresence>
        {open ? (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="experience-survey-title"
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="relative mx-4 flex max-h-[min(92vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-[#2A4792] via-[#3B569F] to-[#4785B8]" />

            {!success ? (
              <>
                <button
                  type="button"
                  onClick={handleClose}
                  aria-label="Close feedback survey"
                  className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>

                <div className="overflow-y-auto px-6 pb-6 pt-7">
                  <h2
                    id="experience-survey-title"
                    className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl"
                  >
                    We&apos;d love your feedback
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    Your experience helps us improve Ontap for everyone.
                  </p>

                  <div className="mt-6">
                    <p className="text-sm font-semibold text-slate-900">
                      How has your experience with Ontap been?
                    </p>
                    <div
                      className="mt-3 flex items-center justify-center gap-2"
                      role="radiogroup"
                      aria-label="Experience rating from 1 to 5"
                    >
                      {[1, 2, 3, 4, 5].map((value) => {
                        const selected = rating === value;
                        const highlighted = (activeRating ?? 0) >= value;
                        return (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            aria-label={`${value} — ${RATING_LABELS[value]}`}
                            onClick={() => {
                              setRating(value);
                              setError("");
                            }}
                            onMouseEnter={() => setHoverRating(value)}
                            onMouseLeave={() => setHoverRating(null)}
                            onFocus={() => setHoverRating(value)}
                            onBlur={() => setHoverRating(null)}
                            className="rounded-lg p-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                          >
                            <Star
                              className={`h-8 w-8 sm:h-9 sm:w-9 ${
                                highlighted
                                  ? "fill-amber-400 text-amber-400"
                                  : "text-slate-300"
                              }`}
                              aria-hidden="true"
                            />
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                      <span>1 = Very difficult</span>
                      <span className="font-medium text-slate-700">
                        {displayRatingLabel ?? "Select a rating"}
                      </span>
                      <span>5 = Excellent</span>
                    </div>
                    {error ? (
                      <p className="mt-2 text-xs font-medium text-red-600" role="alert">
                        {error}
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-6">
                    <label
                      htmlFor="experience-survey-feedback"
                      className="text-sm font-semibold text-slate-900"
                    >
                      What do you think about your experience?
                    </label>
                    <p className="mt-1 text-xs text-slate-500">Optional</p>
                    <textarea
                      id="experience-survey-feedback"
                      value={feedback}
                      onChange={(event) => setFeedback(event.target.value)}
                      maxLength={EXPERIENCE_SURVEY_FEEDBACK_MAX_LENGTH}
                      rows={3}
                      placeholder="Tell us what you like, what feels difficult, or what we can improve..."
                      className="mt-2 w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                  </div>

                  <div className="mt-5">
                    <label
                      htmlFor="experience-survey-feature"
                      className="text-sm font-semibold text-slate-900"
                    >
                      What would you like Ontap to add?
                    </label>
                    <p className="mt-1 text-xs text-slate-500">
                      Have an idea for a feature, tool, or improvement? Tell us what you&apos;d like
                      to see. Optional.
                    </p>
                    <textarea
                      id="experience-survey-feature"
                      value={featureSuggestion}
                      onChange={(event) => setFeatureSuggestion(event.target.value)}
                      maxLength={EXPERIENCE_SURVEY_FEATURE_MAX_LENGTH}
                      rows={3}
                      placeholder="Suggest a feature or improvement..."
                      className="mt-2 w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                  </div>

                  <div className="mt-6 flex flex-col gap-2">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void handleSubmit()}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:opacity-60"
                    >
                      {submitting ? (
                        <>
                          <InlineLoader />
                          Submitting...
                        </>
                      ) : (
                        "Submit Feedback"
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void dismissSurvey()}
                      className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                    >
                      Maybe later
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="px-6 py-10 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <Check className="h-7 w-7" aria-hidden="true" />
                </div>
                <h2 className="mt-5 text-xl font-bold text-slate-900">Thanks for your feedback!</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Your feedback helps us improve Ontap for everyone.
                </p>
                <button
                  type="button"
                  onClick={closeModal}
                  className="mt-6 inline-flex min-w-[8rem] items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover"
                >
                  Done
                </button>
              </div>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </ModalPortal>
  );
}
