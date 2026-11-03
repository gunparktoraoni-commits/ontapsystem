"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart3,
  Building2,
  HandCoins,
  MessageCircle,
  Users,
  X,
  Sparkles,
} from "lucide-react";
import { ModalPortal } from "@/app/components/ModalPortal";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { buildImpersonationHeaders } from "@/app/lib/superadminImpersonationHandoff";

const SUBSCRIPTION_HREF = "/user/emarket?tab=subscription&reason=trial-recap";

type RecapSummary = {
  first_name: string;
  premium_period: { days: number };
  company: { name: string | null; role: string | null };
  affiliate: {
    is_affiliate: boolean;
    total_earnings: number;
    successful_referrals: number;
  };
  associates: {
    total: number;
    recent: Array<{ name: string }>;
  };
  engagement: {
    profile_views: number;
    contact_saves: number;
    inquiries: number;
    new_connections: number;
  };
  interactions: {
    inquiry_contacts: Array<{ name: string }>;
  };
  highlights: string[];
};

type PremiumTrialRecapModalProps = {
  enabled?: boolean;
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(value);
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div
      className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-center"
      style={{ borderTopWidth: 3, borderTopColor: accent }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

export function PremiumTrialRecapModal({ enabled = true }: PremiumTrialRecapModalProps) {
  const API = getFrontendApiBaseUrl();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<RecapSummary | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${API}/api/user/premium-trial-recap`, {
          credentials: "include",
          cache: "no-store",
          headers: buildImpersonationHeaders(),
        });
        if (!res.ok) return;
        const payload = await res.json().catch(() => null);
        const data = payload?.data ?? null;
        if (cancelled || !data?.eligible || !data?.summary) return;
        setSummary(data.summary as RecapSummary);
        setOpen(true);
      } catch {
        // Non-blocking
      } finally {
        if (!cancelled) setChecked(true);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [API, enabled]);

  const dismiss = async () => {
    try {
      await fetch(`${API}/api/user/premium-trial-recap`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...buildImpersonationHeaders(),
        },
        body: JSON.stringify({ action: "dismiss" }),
      });
    } catch {
      // Still close locally
    }
    setOpen(false);
  };

  if (!enabled || !checked) return null;

  return (
    <ModalPortal isOpen={open} onClose={() => void dismiss()}>
      <AnimatePresence>
        {open && summary ? (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="premium-trial-recap-title"
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="relative mx-4 flex max-h-[min(90vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-[#8a4b12] via-[#e67700] to-[#ffe066]" />
            <button
              type="button"
              onClick={() => void dismiss()}
              aria-label="Close recap"
              className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="overflow-y-auto px-5 pb-5 pt-7 sm:px-6 sm:pb-6">
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-3 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-800"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Premium trial recap
              </motion.div>

              <h2
                id="premium-trial-recap-title"
                className="pr-8 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl"
              >
                {summary.first_name}, here is what you built in {summary.premium_period.days} days
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Your exclusive Premium trial has ended. This is a snapshot of your activity — keep
                growing with a Basic, Standard, or Premium BizCard plan.
              </p>

              <ul className="mt-4 space-y-2">
                {summary.highlights.map((item, index) => (
                  <motion.li
                    key={item}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.05 * index }}
                    className="flex items-start gap-2 text-sm text-slate-700"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#2A4792]" />
                    {item}
                  </motion.li>
                ))}
              </ul>

              <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MetricCard
                  label="Profile views"
                  value={summary.engagement.profile_views}
                  accent="#4c6ef5"
                />
                <MetricCard
                  label="Contact saves"
                  value={summary.engagement.contact_saves}
                  accent="#2f9e94"
                />
                <MetricCard
                  label="Inquiries"
                  value={summary.engagement.inquiries}
                  accent="#e67700"
                />
                <MetricCard
                  label="New connections"
                  value={summary.engagement.new_connections}
                  accent="#2A4792"
                />
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {summary.company.name ? (
                  <section className="rounded-xl border border-slate-200 p-4">
                    <div className="mb-2 flex items-center gap-2 text-[#2A4792]">
                      <Building2 className="h-4 w-4" aria-hidden />
                      <h3 className="text-sm font-bold text-slate-900">Company</h3>
                    </div>
                    <p className="text-sm font-semibold text-slate-800">{summary.company.name}</p>
                    {summary.company.role ? (
                      <p className="mt-0.5 text-xs text-slate-500">Role: {summary.company.role}</p>
                    ) : null}
                  </section>
                ) : null}

                {summary.affiliate.is_affiliate || summary.affiliate.total_earnings > 0 ? (
                  <section className="rounded-xl border border-slate-200 p-4">
                    <div className="mb-2 flex items-center gap-2 text-[#2A4792]">
                      <HandCoins className="h-4 w-4" aria-hidden />
                      <h3 className="text-sm font-bold text-slate-900">Referral commissions</h3>
                    </div>
                    <p className="text-sm font-semibold text-slate-800">
                      {formatCurrency(summary.affiliate.total_earnings)} earned
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {summary.affiliate.successful_referrals} successful referral
                      {summary.affiliate.successful_referrals === 1 ? "" : "s"}
                    </p>
                  </section>
                ) : null}

                <section className="rounded-xl border border-slate-200 p-4">
                  <div className="mb-2 flex items-center gap-2 text-[#2A4792]">
                    <Users className="h-4 w-4" aria-hidden />
                    <h3 className="text-sm font-bold text-slate-900">Associates</h3>
                  </div>
                  <p className="text-sm font-semibold text-slate-800">
                    {summary.associates.total} total
                  </p>
                  {summary.associates.recent.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {summary.associates.recent.slice(0, 4).map((person) => (
                        <li key={person.name} className="truncate text-xs text-slate-600">
                          {person.name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">No associates yet — invite peers from your portfolio.</p>
                  )}
                </section>

                <section className="rounded-xl border border-slate-200 p-4">
                  <div className="mb-2 flex items-center gap-2 text-[#2A4792]">
                    <MessageCircle className="h-4 w-4" aria-hidden />
                    <h3 className="text-sm font-bold text-slate-900">People you interacted with</h3>
                  </div>
                  {summary.interactions.inquiry_contacts.length > 0 ? (
                    <ul className="space-y-1">
                      {summary.interactions.inquiry_contacts.map((contact) => (
                        <li key={contact.name} className="truncate text-xs text-slate-600">
                          {contact.name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Inquiry contacts will appear here when visitors message you.
                    </p>
                  )}
                </section>
              </div>

              <div className="mt-5 flex items-start gap-2 rounded-xl bg-[#EEF3FB] p-3 text-xs text-slate-600">
                <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-[#2A4792]" aria-hidden />
                <p>
                  Metrics cover your {summary.premium_period.days}-day Premium trial window. Upgrade to
                  keep Inquiry, Analytics, and advanced BizCard tools active.
                </p>
              </div>

              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => void dismiss()}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Continue to portal
                </button>
                <Link
                  href={SUBSCRIPTION_HREF}
                  onClick={() => void dismiss()}
                  className="inline-flex items-center justify-center rounded-xl bg-[#2A4792] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#243d7d]"
                >
                  View subscription plans
                </Link>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </ModalPortal>
  );
}
