"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Sparkles } from "lucide-react";
import { getFrontendApiBaseUrl } from "./apiBase";
import { withImpersonationHeaders } from "../lib/superadminImpersonationHandoff";
import { hasActivePremiumPlan } from "./subscriptionAccess";
import { openPremiumUpgradeExperience } from "./premium/PremiumUpgradeExperience";

const USER_SYNC_EVENT = "ontap:user-sync";
const PREMIUM_POLL_MS = 30_000;

type ProgressState = {
  qualified: number;
  target: number;
  nextReward: string;
};

type PlanContext = {
  isPremium: boolean;
  isFreeTrial: boolean;
  daysRemaining: number | null;
  planLabel: "Free Trial" | "Basic" | "Standard" | "Premium" | null;
};

function resolvePlanContext(data: Record<string, unknown> | null): PlanContext {
  if (!data) {
    return {
      isPremium: false,
      isFreeTrial: false,
      daysRemaining: null,
      planLabel: null,
    };
  }

  const tier = data.tier != null ? String(data.tier) : null;
  const accessReason =
    data.access_reason != null ? String(data.access_reason) : null;
  const isTrial = Boolean(data.is_trial);
  const status = data.status != null ? String(data.status) : null;
  const isExpired = Boolean(data.is_expired);
  const daysRemaining =
    data.days_remaining != null ? Number(data.days_remaining) : null;

  const normalizedTier = String(tier ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const reason = String(accessReason ?? "").trim().toLowerCase();
  const isFreeTrial =
    normalizedTier === "free_trial" ||
    reason === "free_trial" ||
    (normalizedTier === "none" && (isTrial || reason === "free_trial"));

  let planLabel: PlanContext["planLabel"] = null;
  if (isFreeTrial) planLabel = "Free Trial";
  else if (normalizedTier === "basic") planLabel = "Basic";
  else if (normalizedTier === "standard") planLabel = "Standard";
  else if (normalizedTier === "premium") planLabel = "Premium";

  return {
    isPremium: hasActivePremiumPlan({
      tier,
      accessReason,
      isTrial,
      status,
      isExpired,
    }),
    isFreeTrial,
    daysRemaining,
    planLabel,
  };
}

export default function OntapProgressCard() {
  const [premiumReady, setPremiumReady] = useState(false);
  const [planContext, setPlanContext] = useState<PlanContext>({
    isPremium: false,
    isFreeTrial: false,
    daysRemaining: null,
    planLabel: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [progress, setProgress] = useState<ProgressState>({
    qualified: 0,
    target: 10,
    nextReward: "Reward",
  });

  const loadPremiumAccess = useCallback(async () => {
    try {
      const response = await fetch(
        `${getFrontendApiBaseUrl()}/api/user/subscription`,
        {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          headers: withImpersonationHeaders(),
        },
      );
      if (!response.ok) {
        setPlanContext({
          isPremium: false,
          isFreeTrial: false,
          daysRemaining: null,
          planLabel: null,
        });
        return;
      }
      const payload = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const data =
        payload?.data && typeof payload.data === "object"
          ? (payload.data as Record<string, unknown>)
          : null;

      setPlanContext(resolvePlanContext(data));
    } catch {
      setPlanContext({
        isPremium: false,
        isFreeTrial: false,
        daysRemaining: null,
        planLabel: null,
      });
    } finally {
      setPremiumReady(true);
    }
  }, []);

  useEffect(() => {
    void loadPremiumAccess();
    window.addEventListener(USER_SYNC_EVENT, loadPremiumAccess);
    window.addEventListener("focus", loadPremiumAccess);
    const intervalId = window.setInterval(() => {
      void loadPremiumAccess();
    }, PREMIUM_POLL_MS);
    return () => {
      window.removeEventListener(USER_SYNC_EVENT, loadPremiumAccess);
      window.removeEventListener("focus", loadPremiumAccess);
      window.clearInterval(intervalId);
    };
  }, [loadPremiumAccess]);

  useEffect(() => {
    if (!premiumReady || !planContext.isPremium) return;

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(`${getFrontendApiBaseUrl()}/api/user/missions`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: withImpersonationHeaders(),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success || !payload?.data?.progress) {
          throw new Error("failed");
        }
        if (!cancelled) {
          const p = payload.data.progress;
          setProgress({
            qualified: Number(p.qualified_referrals) || 0,
            target: Number(p.next_target ?? p.target) || 10,
            nextReward: String(p.next_reward_label || "Reward"),
          });
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [premiumReady, planContext.isPremium]);

  if (!premiumReady) return null;

  if (!planContext.isPremium) {
    const ctaLabel = planContext.isFreeTrial
      ? "Explore Premium"
      : "Upgrade to Premium";
    const trialNote =
      planContext.isFreeTrial &&
      planContext.daysRemaining != null &&
      planContext.daysRemaining > 0
        ? `${planContext.daysRemaining} day${planContext.daysRemaining === 1 ? "" : "s"} left in your free trial.`
        : null;

    return (
      <div className="bg-white border border-gray-100 rounded-3xl p-4 sm:p-6 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#4785B8]">
          Premium
        </p>
        <div className="mt-2 flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#EEF3FB] text-[#2A4792]">
            <Sparkles className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800">
              Unlock Missions &amp; Rewards
            </p>
            <p className="mt-1 text-sm leading-relaxed text-gray-500">
              Grow your network, complete missions, and earn exclusive rewards
              with Premium
              {planContext.planLabel && planContext.planLabel !== "Premium"
                ? ` — you're on ${planContext.planLabel}`
                : ""}
              .
            </p>
            {trialNote ? (
              <p className="mt-2 text-xs font-medium text-[#2A4792]">
                {trialNote}
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-4">
          <button
            type="button"
            onClick={() =>
              openPremiumUpgradeExperience({ source: "dashboard" })
            }
            className="inline-flex items-center gap-1 text-sm font-bold text-[#2A4792] hover:text-[#1c2763]"
          >
            {ctaLabel}
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  const pct =
    progress.target > 0
      ? Math.min(100, Math.round((progress.qualified / progress.target) * 100))
      : 0;

  return (
    <div className="bg-white border border-gray-100 rounded-3xl p-4 sm:p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="min-w-0 text-[10px] font-bold uppercase tracking-[0.14em] text-[#4785B8]">
          Your Ontap Progress
        </p>
        <span className="rounded-full bg-[#EEF3FB] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#2A4792]">
          Premium Member
        </span>
      </div>
      {loading ? (
        <div className="mt-3 h-16 animate-pulse rounded-xl bg-gray-100" />
      ) : error ? (
        <p className="mt-2 text-sm text-gray-500">
          Progress unavailable right now.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm font-semibold text-gray-700">
            {progress.qualified} / {progress.target} qualified referrals
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#D5DDEF]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#20387D,#4785B8)]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-4 text-sm text-gray-500">
            Next reward:{" "}
            <span className="font-semibold text-gray-800">
              {progress.nextReward}
            </span>
          </p>
        </>
      )}
      <div className="mt-4">
        <Link
          href="/user/missions"
          className="inline-flex items-center gap-1 text-sm font-bold text-[#2A4792] hover:text-[#1c2763]"
        >
          View Missions
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
