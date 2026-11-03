"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { ModalPortal } from "../ModalPortal";
import {
  RewardPreviewBlock,
  type MissionRewardPreview,
} from "./RewardPreviewBlock";
import { ProgressBar } from "./ProgressMilestoneBar";

type Props = {
  open: boolean;
  onClose: () => void;
  missionTitle: string;
  instruction: string;
  requirementType: string;
  current: number;
  target: number;
  reward: MissionRewardPreview | null;
};

export function MissionHelpModal({
  open,
  onClose,
  missionTitle,
  instruction,
  requirementType,
  current,
  target,
  reward,
}: Props) {
  const isQualified = requirementType === "qualified_referrals";

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
        aria-labelledby="mission-help-title"
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

        <p className="text-[11px] font-bold uppercase tracking-wide text-[#2A4792]">
          How to complete
        </p>
        <h2
          id="mission-help-title"
          className="mt-1 text-lg font-extrabold text-gray-950"
        >
          {missionTitle}
        </h2>

        <div className="mt-4 whitespace-pre-line text-sm leading-relaxed text-gray-600">
          {instruction ||
            `Reach ${target} qualified referrals to complete this mission.`}
        </div>

        {isQualified ? (
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
              <p className="text-[11px] font-bold uppercase text-emerald-700">
                What counts
              </p>
              <ul className="mt-2 space-y-1 text-xs text-emerald-800">
                <li>✓ Qualified referrals</li>
                <li>✓ Paid subscription</li>
                <li>✓ Paid marketplace order</li>
              </ul>
            </div>
            <div className="rounded-xl border border-rose-100 bg-rose-50/60 p-3">
              <p className="text-[11px] font-bold uppercase text-rose-700">
                What does not count
              </p>
              <ul className="mt-2 space-y-1 text-xs text-rose-800">
                <li>× Link clicks</li>
                <li>× Registration alone</li>
                <li>× Pending transactions</li>
              </ul>
            </div>
          </div>
        ) : null}

        <div className="mt-5">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-500">
            Your progress
          </p>
          <div className="mb-2 flex justify-between text-xs font-semibold text-gray-600">
            <span>
              {current} / {target} qualified referrals
            </span>
          </div>
          <ProgressBar current={current} target={target} />
        </div>

        <div className="mt-5">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-500">
            Reward
          </p>
          <RewardPreviewBlock reward={reward} target={target} />
        </div>
      </div>
    </ModalPortal>
  );
}
