"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Check, X } from "lucide-react";
import { ModalPortal } from "@/app/components/ModalPortal";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { buildImpersonationHeaders } from "@/app/lib/superadminImpersonationHandoff";
import { showToast } from "@/app/components/Toast";

const CSRF_COOKIE_NAME = "csrf-token";
const DISMISS_SESSION_KEY = "ontap:exclusive-premium-offer:session-dismiss";

function readCsrfCookie(): string {
  if (typeof document === "undefined") return "";
  const target = `${CSRF_COOKIE_NAME}=`;
  const match = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(target));
  return match ? decodeURIComponent(match.slice(target.length)) : "";
}

async function ensureCsrfToken(apiBase: string): Promise<string> {
  const fromCookie = readCsrfCookie();
  if (fromCookie) return fromCookie;
  try {
    const response = await fetch(`${apiBase}/api/csrf-token`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return readCsrfCookie();
    const payload = await response.json().catch(() => null);
    return (
      String(payload?.csrfToken || payload?.csrf_token || payload?.token || "") ||
      readCsrfCookie()
    );
  } catch {
    return readCsrfCookie();
  }
}

const PREMIUM_HIGHLIGHTS = [
  "Inquiry inbox and visitor messages",
  "Advanced analytics and engagement insights",
  "Premium themes and gallery tools",
  "Full feature set normally reserved for Premium",
];

type ExclusivePremiumOfferModalProps = {
  enabled?: boolean;
};

export function ExclusivePremiumOfferModal({
  enabled = true,
}: ExclusivePremiumOfferModalProps) {
  const API = getFrontendApiBaseUrl();
  const [open, setOpen] = useState(false);
  const [exclusiveDays, setExclusiveDays] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    if (window.sessionStorage.getItem(DISMISS_SESSION_KEY) === "1") {
      setChecked(true);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${API}/api/user/premium-experience-offer`, {
          credentials: "include",
          cache: "no-store",
          headers: buildImpersonationHeaders(),
        });
        if (!res.ok) return;
        const payload = await res.json().catch(() => null);
        const data = payload?.data ?? null;
        if (cancelled || !data?.eligible) return;
        setExclusiveDays(Number(data.exclusive_days) || 14);
        setOpen(true);
      } catch {
        // Non-blocking — offer can be checked again on next navigation.
      } finally {
        if (!cancelled) setChecked(true);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [API, enabled]);

  const closeForSession = () => {
    try {
      window.sessionStorage.setItem(DISMISS_SESSION_KEY, "1");
    } catch {
      // ignore
    }
    setOpen(false);
  };

  const respond = async (decision: "accept" | "decline") => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const csrf = await ensureCsrfToken(API);
      const res = await fetch(`${API}/api/user/premium-experience-offer`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
          ...buildImpersonationHeaders(),
        },
        body: JSON.stringify({ decision }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) {
        showToast(
          String(payload?.error?.message || "Unable to save your choice. Please try again."),
          "error",
        );
        return;
      }
      if (decision === "accept") {
        showToast(
          `Premium features unlocked for ${exclusiveDays} days. Explore Inquiry and Analytics now.`,
          "success",
        );
        window.dispatchEvent(new CustomEvent("ontap:user-sync"));
      }
      closeForSession();
    } catch {
      showToast("Unable to save your choice. Please try again.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (!enabled || !checked) return null;

  return (
    <ModalPortal isOpen={open} onClose={closeForSession}>
      <AnimatePresence>
        {open ? (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="exclusive-premium-offer-title"
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="relative mx-4 w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-[#2A4792] via-[#3B569F] to-[#4785B8]" />
            <button
              type="button"
              onClick={closeForSession}
              aria-label="Close exclusive offer"
              className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="px-6 pb-6 pt-7">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 }}
                className="mb-4 inline-flex items-center gap-2 rounded-full bg-[#EEF3FB] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#2A4792]"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Free trial exclusive
              </motion.div>

              <h2
                id="exclusive-premium-offer-title"
                className="text-2xl font-bold tracking-tight text-slate-900"
              >
                Try Premium for {exclusiveDays} days
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                As a new free-trial member, you can unlock a private {exclusiveDays}-day
                Premium experience — no paid Basic, Standard, or Premium plan required.
              </p>

              <ul className="mt-5 space-y-2.5">
                {PREMIUM_HIGHLIGHTS.map((item, index) => (
                  <motion.li
                    key={item}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.12 + index * 0.05 }}
                    className="flex items-start gap-2.5 text-sm text-slate-700"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                      <Check className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    {item}
                  </motion.li>
                ))}
              </ul>

              <div className="mt-6 flex flex-col gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void respond("accept")}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-[#2A4792] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#243d7d] disabled:opacity-60"
                >
                  {submitting ? "Please wait…" : `Yes — start my ${exclusiveDays}-day Premium trial`}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void respond("decline")}
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  Don&apos;t show this again
                </button>
              </div>
              <p className="mt-3 text-center text-xs text-slate-400">
                Closing with ✕ reminds you later this session. &quot;Don&apos;t show this again&quot; permanently hides this offer.
              </p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </ModalPortal>
  );
}
