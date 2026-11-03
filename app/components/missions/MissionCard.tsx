"use client";

import { Check, Gift, HelpCircle, Target } from "lucide-react";
import { motion } from "framer-motion";
import {
  ProgressBar,
  progressPercent,
} from "./ProgressMilestoneBar";
import { RewardPreviewBlock, type MissionRewardPreview } from "./RewardPreviewBlock";

export type MissionCardData = {
  key: string;
  title: string;
  description: string;
  instruction: string;
  requirement_type: string;
  current: number;
  target: number;
  completed: boolean;
  status: "completed" | "next_milestone" | "in_progress";
  reward_label: string;
  reward: MissionRewardPreview | null;
};

type Props = {
  mission: MissionCardData;
  onHelp: () => void;
  onViewReward: () => void;
  onContinue: () => void;
};

export function MissionCard({
  mission,
  onHelp,
  onViewReward,
  onContinue,
}: Props) {
  const unlocked = Boolean(mission.reward?.user_reward_status);
  const isNext = mission.status === "next_milestone";
  const isDone = mission.completed;

  return (
    <motion.div
      layout
      className={`rounded-2xl border bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)] transition-shadow hover:shadow-[0_10px_28px_rgba(15,23,42,0.08)] ${
        isNext ? "border-[#2A4792]/40 ring-1 ring-[#2A4792]/15" : "border-gray-100"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
              isDone
                ? "bg-emerald-50 text-emerald-600"
                : "bg-[#EEF2FA] text-[#2A4792]"
            }`}
          >
            {isDone ? <Check className="h-5 w-5" /> : <Target className="h-5 w-5" />}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-gray-800">{mission.title}</h3>
              {isNext ? (
                <span className="rounded-full bg-[#EEF2FA] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#2A4792]">
                  Next milestone
                </span>
              ) : null}
              {isDone ? (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                  Completed
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-gray-500">{mission.description}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onHelp}
          aria-label="How to complete this mission"
          className="rounded-full border border-[#d8deee] p-1.5 text-[#2A4792] hover:bg-[#EEF2FA]"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-gray-500">
          <span>
            {mission.current} / {mission.target} completed
          </span>
          <span className={isDone ? "text-emerald-600" : "text-[#2A4792]"}>
            {progressPercent(mission.current, mission.target)}%
          </span>
        </div>
        <ProgressBar
          current={mission.current}
          target={mission.target}
          completed={isDone}
        />
      </div>

      <div className="mt-4">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-500">
          Reward for completion
        </p>
        <RewardPreviewBlock reward={mission.reward} target={mission.target} />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onViewReward}
          disabled={!mission.reward}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[#d8deee] px-3 py-2 text-xs font-bold text-[#2A4792] hover:bg-[#F8FAFD] disabled:opacity-40"
        >
          <Gift className="h-3.5 w-3.5" />
          View Reward
        </button>
        {isDone ? (
          <span className="text-xs font-semibold text-emerald-600">
            {unlocked ? "✓ Reward unlocked" : "✓ Mission completed"}
          </span>
        ) : (
          <button
            type="button"
            onClick={onContinue}
            className="inline-flex items-center rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-primary-hover"
          >
            Continue Mission →
          </button>
        )}
      </div>
    </motion.div>
  );
}
