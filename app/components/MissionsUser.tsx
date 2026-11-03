"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, Gift, Link2, Sparkles, Trophy } from "lucide-react";
import { getFrontendApiBaseUrl } from "./apiBase";
import { SectionLoader } from "./Loader";
import { MissionCard, type MissionCardData } from "./missions/MissionCard";
import { MissionHelpModal } from "./missions/MissionHelpModal";
import { RewardViewModal } from "./missions/RewardViewModal";
import {
  ProgressBar,
  ProgressMilestoneBar,
} from "./missions/ProgressMilestoneBar";
import {
  rewardTypeLabel,
  type MissionRewardPreview,
} from "./missions/RewardPreviewBlock";
import { hasActivePremiumPlan } from "./subscriptionAccess";
import { openPremiumUpgradeExperience } from "./premium/PremiumUpgradeExperience";
import { withImpersonationHeaders } from "../lib/superadminImpersonationHandoff";

type MissionsTab = "missions" | "rewards" | "referrals";

const TABS: { id: MissionsTab; label: string }[] = [
  { id: "missions", label: "Missions" },
  { id: "rewards", label: "Rewards" },
  { id: "referrals", label: "Referrals" },
];

type UserRewardItem = {
  id: string;
  reward_id: string;
  name: string;
  description: string | null;
  type: string;
  status: string;
  unlocked_at: string;
  claimed_at: string | null;
  expires_at: string | null;
  mission_key: string | null;
  mission_title: string | null;
  duration_days: number | null;
  theme_name: string | null;
  theme_path: string | null;
  theme_preview_image?: string | null;
  theme_tag?: string | null;
  feature_key?: string | null;
  redeemable: boolean;
};

type ActivityItem = {
  id: string;
  display_name: string;
  status: string;
  qualification_source: string | null;
  created_at: string;
  qualified_at: string | null;
};

type MissionsData = {
  referral_link: string;
  referral_code: string | null;
  progress: {
    qualified_referrals: number;
    target: number;
    next_reward_label: string;
    current_milestone_title?: string;
    remaining?: number;
    next_target?: number;
  };
  milestones?: {
    key: string;
    title: string;
    target: number;
    completed: boolean;
  }[];
  stats: {
    total_referrals: number;
    qualified_referrals: number;
    pending_referrals: number;
    incomplete_referrals: number;
  };
  missions: MissionCardData[];
  activity: ActivityItem[];
};

function activityStatusLabel(status: string) {
  if (status === "qualified") return "Qualified";
  if (status === "pending") return "Pending";
  return status;
}

function sourceLabel(source: string | null) {
  if (source === "subscription") return "Subscription";
  if (source === "marketplace_purchase") return "Marketplace Purchase";
  return null;
}

export default function MissionsUser() {
  const [premiumReady, setPremiumReady] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [activeTab, setActiveTab] = useState<MissionsTab>("missions");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MissionsData | null>(null);
  const [rewards, setRewards] = useState<UserRewardItem[]>([]);
  const [rewardsLoading, setRewardsLoading] = useState(false);
  const [rewardsError, setRewardsError] = useState<string | null>(null);

  const [helpMission, setHelpMission] = useState<MissionCardData | null>(null);
  const [viewMission, setViewMission] = useState<MissionCardData | null>(null);
  const [viewOwned, setViewOwned] = useState<UserRewardItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadPremium = async () => {
      try {
        const res = await fetch(
          `${getFrontendApiBaseUrl()}/api/user/subscription`,
          {
            method: "GET",
            credentials: "include",
            cache: "no-store",
            headers: withImpersonationHeaders(),
          },
        );
        if (!res.ok) {
          if (!cancelled) setIsPremium(false);
          return;
        }
        const payload = await res.json().catch(() => null);
        const sub =
          payload?.data && typeof payload.data === "object"
            ? (payload.data as Record<string, unknown>)
            : null;
        if (!cancelled) {
          setIsPremium(
            hasActivePremiumPlan({
              tier: sub?.tier != null ? String(sub.tier) : null,
              accessReason:
                sub?.access_reason != null ? String(sub.access_reason) : null,
              isTrial: Boolean(sub?.is_trial),
              status: sub?.status != null ? String(sub.status) : null,
              isExpired: Boolean(sub?.is_expired),
            }),
          );
        }
      } catch {
        if (!cancelled) setIsPremium(false);
      } finally {
        if (!cancelled) setPremiumReady(true);
      }
    };
    void loadPremium();
    const onSync = () => void loadPremium();
    window.addEventListener("ontap:user-sync", onSync);
    return () => {
      cancelled = true;
      window.removeEventListener("ontap:user-sync", onSync);
    };
  }, []);

  useEffect(() => {
    if (!premiumReady || !isPremium) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${getFrontendApiBaseUrl()}/api/user/missions`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success || !payload?.data) {
          throw new Error(
            payload?.error?.message ||
              payload?.error ||
              "Unable to load missions data.",
          );
        }
        if (!cancelled) setData(payload.data as MissionsData);
      } catch (err) {
        if (!cancelled) {
          setData(null);
          setError(
            err instanceof Error ? err.message : "Unable to load missions data.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [premiumReady, isPremium]);

  useEffect(() => {
    if (!isPremium || activeTab !== "rewards") return;
    let cancelled = false;
    const loadRewards = async () => {
      setRewardsLoading(true);
      setRewardsError(null);
      try {
        const res = await fetch(`${getFrontendApiBaseUrl()}/api/user/rewards`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success || !payload?.data) {
          throw new Error(
            payload?.error?.message ||
              payload?.error ||
              "Unable to load rewards.",
          );
        }
        if (!cancelled) {
          setRewards((payload.data.rewards ?? []) as UserRewardItem[]);
        }
      } catch (err) {
        if (!cancelled) {
          setRewards([]);
          setRewardsError(
            err instanceof Error ? err.message : "Unable to load rewards.",
          );
        }
      } finally {
        if (!cancelled) setRewardsLoading(false);
      }
    };
    void loadRewards();
    return () => {
      cancelled = true;
    };
  }, [activeTab, isPremium]);

  const handleCopy = () => {
    if (!data?.referral_link) return;
    void navigator.clipboard.writeText(data.referral_link).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!premiumReady) {
    return (
      <div className="w-full min-h-full rounded-2xl border border-[#d8deee] bg-white p-4 sm:p-6 lg:p-7 shadow-sm">
        <SectionLoader text="Loading missions..." />
      </div>
    );
  }

  if (!isPremium) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 py-4 sm:py-6">
        <div className="overflow-hidden rounded-2xl border border-[#d8deee] bg-white shadow-sm">
          <div className="h-1.5 bg-gradient-to-r from-[#2A4792] via-[#3B569F] to-[#4785B8]" />
          <div className="p-5 sm:p-7">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#EEF3FB]">
              <Trophy className="h-7 w-7 text-[#2A4792]" aria-hidden />
            </div>
            <h1 className="text-center text-2xl font-extrabold tracking-tight text-gray-950">
              Unlock Missions &amp; Rewards
            </h1>
            <p className="mx-auto mt-2 max-w-md text-center text-sm leading-relaxed text-gray-500">
              Build your network, complete missions, and unlock exclusive rewards
              with Premium.
            </p>

            <div className="mt-6 rounded-2xl border border-dashed border-[#A8B8D9] bg-[#F7F9FD] p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#4785B8]">
                Preview
              </p>
              <div className="mt-3 space-y-2">
                <div className="rounded-xl border border-white bg-white/80 px-3 py-2.5 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-gray-800">
                      Grow your network
                    </span>
                    <span className="rounded-full bg-[#EEF3FB] px-2 py-0.5 text-[10px] font-bold text-[#2A4792]">
                      Mission
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#D5DDEF]">
                    <div className="h-full w-1/3 rounded-full bg-[linear-gradient(90deg,#20387D,#4785B8)]" />
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-white bg-white/80 px-3 py-2.5 text-sm text-gray-600 shadow-sm">
                  <Gift className="h-4 w-4 text-[#2A4792]" aria-hidden />
                  Exclusive rewards unlock as you qualify referrals
                </div>
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                <Sparkles className="h-3.5 w-3.5 text-[#2A4792]" aria-hidden />
                Full access requires an active Premium plan
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                openPremiumUpgradeExperience({ source: "missions" })
              }
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#2A4792] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#243d7d]"
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              Explore Premium
            </button>
          </div>
        </div>
      </div>
    );
  }

  const qualified = data?.progress.qualified_referrals ?? 0;
  const progressTarget = data?.progress.next_target ?? data?.progress.target ?? 10;
  const remaining =
    data?.progress.remaining ?? Math.max(0, progressTarget - qualified);
  const nextReward = data?.progress.next_reward_label ?? "Reward";
  const milestoneTitle =
    data?.progress.current_milestone_title ?? "Your next milestone";

  if (loading) {
    return (
      <div className="w-full min-h-full rounded-2xl border border-[#d8deee] bg-white p-4 sm:p-6 lg:p-7 shadow-sm">
        <SectionLoader text="Loading missions..." />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="w-full min-h-full rounded-2xl border border-[#d8deee] bg-white p-4 sm:p-6 lg:p-7 shadow-sm">
        <header className="mb-6">
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-950 sm:text-3xl">
            Missions
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Complete missions, grow your network, and unlock Ontap rewards.
          </p>
        </header>
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || "Unable to load missions data."}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-full rounded-2xl border border-[#d8deee] bg-white p-4 sm:p-6 lg:p-7 shadow-sm">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-gray-950 sm:text-3xl">
          Missions
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Complete missions, grow your network, and unlock Ontap rewards.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-xl px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold transition-all duration-300 shadow-sm border ${
                isActive
                  ? "border-transparent text-white"
                  : "border-[#d8deee] bg-transparent text-[#4b5563] hover:bg-gray-50"
              }`}
              style={
                isActive
                  ? { background: "linear-gradient(135deg, #2A4792, #4785B8)" }
                  : undefined
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        {activeTab === "missions" && (
          <div className="flex flex-col gap-6">
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)] sm:p-6">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#4785B8]">
                Your Ontap Progress
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <span className="rounded-full bg-[#EEF2FA] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#2A4792]">
                  {milestoneTitle}
                </span>
                <p className="text-sm font-semibold text-gray-700">
                  {qualified} / {progressTarget} qualified referrals
                </p>
              </div>
              <ProgressMilestoneBar
                milestones={data.milestones ?? []}
                qualified={qualified}
              />
              <div className="mt-4">
                <ProgressBar current={qualified} target={progressTarget} />
              </div>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-gray-500">
                  {remaining > 0 ? (
                    <>
                      {remaining} more qualified referral
                      {remaining === 1 ? "" : "s"} to unlock{" "}
                      <span className="font-semibold text-gray-800">
                        {nextReward}
                      </span>
                    </>
                  ) : (
                    <>All active milestones complete.</>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab("referrals")}
                  className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-primary-hover active:scale-[0.98]"
                >
                  View Referral Link
                </button>
              </div>
            </div>

            <div>
              <h2 className="mb-4 text-base font-bold text-gray-950">
                Active Missions
              </h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {data.missions.map((mission) => (
                  <MissionCard
                    key={mission.key}
                    mission={mission}
                    onHelp={() => setHelpMission(mission)}
                    onViewReward={() => {
                      setViewOwned(null);
                      setViewMission(mission);
                    }}
                    onContinue={() => setActiveTab("referrals")}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "rewards" && (
          <div>
            <h2 className="mb-4 text-base font-bold text-gray-950">
              Your Rewards
            </h2>
            {rewardsLoading ? (
              <SectionLoader text="Loading rewards..." />
            ) : rewardsError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {rewardsError}
              </div>
            ) : rewards.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#D5DDEF] bg-[#F8FAFD] px-6 py-10 text-center text-sm text-gray-500">
                No rewards unlocked yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {rewards.map((reward) => (
                  <div
                    key={reward.id}
                    className="rounded-2xl border border-gray-100 bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-[#e8edf7] bg-[#F8FAFD]">
                          {reward.theme_preview_image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={reward.theme_preview_image}
                              alt={reward.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-emerald-600">
                              <Gift className="h-5 w-5" />
                            </div>
                          )}
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-gray-800">
                            {reward.name}
                          </h3>
                          <p className="mt-0.5 text-[11px] font-semibold text-gray-500">
                            {rewardTypeLabel(reward.type)}
                          </p>
                          <p className="mt-1 text-xs text-gray-500">
                            {reward.mission_title
                              ? `Unlocked from ${reward.mission_title}`
                              : "Unlocked reward"}
                          </p>
                          <p className="mt-1 text-[10px] text-gray-400">
                            {new Date(reward.unlocked_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold capitalize text-emerald-600">
                        Unlocked
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setViewMission(null);
                        setViewOwned(reward);
                      }}
                      className="mt-4 inline-flex items-center rounded-xl border border-[#d8deee] px-4 py-2 text-sm font-semibold text-[#2A4792] hover:bg-[#F8FAFD]"
                    >
                      View Reward
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "referrals" && (
          <div className="flex flex-col gap-6">
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)] sm:p-6">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#EEF2FA] text-[#2A4792]">
                <Link2 className="h-5 w-5" />
              </div>
              <h2 className="text-base font-bold text-gray-950">
                Your Referral Link
              </h2>
              <div className="mt-4 flex min-w-0 items-center justify-between gap-2 rounded-2xl border border-[#d8deee] bg-[#F8FAFD] p-1.5">
                <span className="min-w-0 truncate px-2 text-sm font-medium text-gray-700 sm:px-3">
                  {data.referral_link}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white shadow-sm transition-all hover:bg-primary-hover sm:px-4 sm:text-sm"
                >
                  {copied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copied ? "Copied" : "Copy Link"}
                </button>
              </div>
            </div>

            <div>
              <h2 className="mb-4 text-base font-bold text-gray-950">
                Referral Statistics
              </h2>
              <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                {[
                  {
                    label: "Total Referrals",
                    value: data.stats.total_referrals,
                  },
                  {
                    label: "Qualified",
                    value: data.stats.qualified_referrals,
                  },
                  {
                    label: "Pending",
                    value: data.stats.pending_referrals,
                  },
                  {
                    label: "Incomplete",
                    value: data.stats.incomplete_referrals,
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-2xl border border-gray-100 bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)]"
                  >
                    <p className="text-sm font-semibold text-gray-500">
                      {stat.label}
                    </p>
                    <p className="mt-2 text-2xl font-extrabold tracking-tight text-gray-950">
                      {stat.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-[0_6px_24px_rgba(15,23,42,0.05)]">
              <div className="border-b border-gray-100 bg-gray-50/50 px-6 py-4">
                <h2 className="text-base font-bold text-gray-950">
                  Referral activity
                </h2>
              </div>
              {data.activity.length === 0 ? (
                <div className="px-6 py-10 text-center text-sm text-gray-500">
                  No referral activity yet.
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {data.activity.map((row) => {
                    const source = sourceLabel(row.qualification_source);
                    return (
                      <li
                        key={row.id}
                        className="flex items-center justify-between gap-3 px-6 py-4"
                      >
                        <div className="min-w-0">
                          <span className="text-sm font-bold text-gray-800">
                            {row.display_name}
                          </span>
                          {source ? (
                            <p className="mt-0.5 text-xs text-gray-400">
                              {source}
                            </p>
                          ) : null}
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-1 text-[10px] font-bold capitalize ${
                            row.status === "qualified"
                              ? "bg-emerald-50 text-emerald-600"
                              : "bg-amber-50 text-amber-600"
                          }`}
                        >
                          {activityStatusLabel(row.status)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </motion.div>

      {helpMission ? (
        <MissionHelpModal
          open={Boolean(helpMission)}
          onClose={() => setHelpMission(null)}
          missionTitle={helpMission.title}
          instruction={helpMission.instruction}
          requirementType={helpMission.requirement_type}
          current={helpMission.current}
          target={helpMission.target}
          reward={helpMission.reward}
        />
      ) : null}

      {viewMission ? (
        <RewardViewModal
          open={Boolean(viewMission)}
          onClose={() => setViewMission(null)}
          missionTitle={viewMission.title}
          current={viewMission.current}
          target={viewMission.target}
          reward={viewMission.reward}
        />
      ) : null}

      {viewOwned ? (
        <RewardViewModal
          open={Boolean(viewOwned)}
          onClose={() => setViewOwned(null)}
          missionTitle={viewOwned.mission_title || "Mission"}
          current={1}
          target={1}
          reward={
            {
              id: viewOwned.reward_id,
              name: viewOwned.name,
              description: viewOwned.description,
              type: viewOwned.type,
              status: "active",
              duration_days: viewOwned.duration_days,
              theme_id: null,
              theme_name: viewOwned.theme_name,
              theme_path: viewOwned.theme_path,
              theme_preview_image: viewOwned.theme_preview_image ?? null,
              theme_tag: viewOwned.theme_tag ?? null,
              feature_key: viewOwned.feature_key ?? null,
              user_reward_status: viewOwned.status,
              user_reward_id: viewOwned.id,
            } satisfies MissionRewardPreview
          }
          owned={{
            name: viewOwned.name,
            description: viewOwned.description,
            type: viewOwned.type,
            status: viewOwned.status,
            unlocked_at: viewOwned.unlocked_at,
            theme_preview_image: viewOwned.theme_preview_image ?? null,
            theme_name: viewOwned.theme_name,
            duration_days: viewOwned.duration_days,
            feature_key: viewOwned.feature_key ?? null,
          }}
        />
      ) : null}
    </div>
  );
}
