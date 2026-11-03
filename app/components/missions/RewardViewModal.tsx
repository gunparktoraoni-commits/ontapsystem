"use client";

import { useEffect } from "react";
import { Lock, Check, X } from "lucide-react";
import { ModalPortal } from "../ModalPortal";
import {
  rewardTypeLabel,
  type MissionRewardPreview,
} from "./RewardPreviewBlock";
import { ProgressBar } from "./ProgressMilestoneBar";

type Props = {
  open: boolean;
  onClose: () => void;
  missionTitle: string;
  current: number;
  target: number;
  reward: MissionRewardPreview | null;
  owned?: {
    name: string;
    description: string | null;
    type: string;
    status: string;
    unlocked_at: string | null;
    theme_preview_image: string | null;
    theme_name: string | null;
    duration_days: number | null;
    feature_key: string | null;
  } | null;
};

export function RewardViewModal({
  open,
  onClose,
  missionTitle,
  current,
  target,
  reward,
  owned,
}: Props) {
  // Ownership must come from UserReward, not progress alone
  const hasUserReward = Boolean(owned || reward?.user_reward_status);
  const name =
    owned?.name ||
    (reward?.type === "theme_access"
      ? reward.theme_name || reward.name
      : reward?.type === "premium_access"
        ? `${reward.duration_days ?? "—"} Days Premium`
        : reward?.name) ||
    "Reward";
  const type = owned?.type || reward?.type || "";
  const description = owned?.description ?? reward?.description;
  const preview =
    owned?.theme_preview_image || reward?.theme_preview_image || null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <ModalPortal isOpen={open} onClose={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reward-view-title"
        className="relative mx-4 w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <h2
          id="reward-view-title"
          className="pr-8 text-lg font-extrabold text-gray-950"
        >
          {name}
        </h2>
        <p className="mt-1 text-xs font-semibold text-gray-500">
          {rewardTypeLabel(type)}
        </p>

        <div className="mt-4 overflow-hidden rounded-xl border border-[#e8edf7] bg-[#F8FAFD]">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt={name}
              className="h-44 w-full object-cover"
            />
          ) : (
            <div className="flex h-36 items-center justify-center text-4xl">
              {type === "premium_access"
                ? "🎁"
                : type === "feature_access"
                  ? "✨"
                  : "🎨"}
            </div>
          )}
        </div>

        {description ? (
          <p className="mt-3 text-sm text-gray-600">{description}</p>
        ) : null}

        <div className="mt-4 rounded-xl border border-[#e8edf7] bg-[#F8FAFD] p-3">
          <p className="text-[11px] font-bold uppercase text-gray-500">
            Unlock through
          </p>
          <p className="mt-1 text-sm font-bold text-gray-900">{missionTitle}</p>
          <div className="mt-3 mb-2 flex justify-between text-xs font-semibold text-gray-600">
            <span>
              {Math.min(current, target)} / {target} qualified referrals
            </span>
          </div>
          <ProgressBar
            current={current}
            target={target}
            completed={hasUserReward}
          />
        </div>

        <div className="mt-4 flex items-center gap-2">
          {hasUserReward ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
              <Check className="h-3.5 w-3.5" />
              Unlocked
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600">
              <Lock className="h-3.5 w-3.5" />
              Locked
            </span>
          )}
        </div>

        {!hasUserReward ? (
          <p className="mt-3 text-xs text-gray-500">
            Complete the mission to unlock this reward.
          </p>
        ) : (
          <p className="mt-3 text-xs text-gray-500">Redeeming coming soon.</p>
        )}

        <button
          type="button"
          disabled
          className="mt-4 w-full cursor-not-allowed rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white opacity-50"
        >
          Use Reward
        </button>
      </div>
    </ModalPortal>
  );
}
