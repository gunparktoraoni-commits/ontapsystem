"use client";

import { CheckSquare, Download, Share2 } from "lucide-react";

type BizCardInfoActionsProps = {
  onDownloadDigitalCard: () => void;
  onShare: () => void;
  onChecklist: () => void;
  shareDisabled?: boolean;
  downloadDisabled?: boolean;
  checklistActive?: boolean;
  className?: string;
};

export function BizCardInfoActions({
  onDownloadDigitalCard,
  onShare,
  onChecklist,
  shareDisabled = false,
  downloadDisabled = false,
  checklistActive = false,
  className = "",
}: BizCardInfoActionsProps) {
  return (
    <div
      className={`grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] ${className}`}
    >
      <button
        type="button"
        onClick={onDownloadDigitalCard}
        disabled={downloadDisabled}
        className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl bg-[#2A4792] px-4 py-3.5 text-sm font-bold text-white transition hover:bg-[#3B569F] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-1"
      >
        <Download className="h-4 w-4" />
        Download Digital Card
      </button>
      <button
        type="button"
        onClick={onShare}
        disabled={shareDisabled}
        aria-label="Share portfolio"
        title="Share"
        className="inline-flex h-[50px] w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 transition hover:border-[#4785B8]/30 hover:bg-gray-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:w-[50px] sm:gap-0 sm:font-normal"
      >
        <Share2 className="h-4 w-4 shrink-0" />
        <span className="sm:hidden">Share Portfolio</span>
      </button>
      <button
        type="button"
        onClick={onChecklist}
        aria-pressed={checklistActive}
        aria-label="Open checklist"
        title="Checklist"
        className={`inline-flex h-[50px] w-full items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition active:scale-[0.98] sm:w-[50px] sm:gap-0 sm:font-normal ${
          checklistActive
            ? "border-[#4785B8]/40 bg-[#4785B8]/10 text-[#2A4792]"
            : "border-gray-200 bg-white text-gray-700 hover:border-[#4785B8]/30 hover:bg-gray-50"
        }`}
      >
        <CheckSquare className="h-4 w-4 shrink-0" />
        <span className="sm:hidden">Checklist</span>
      </button>
    </div>
  );
}
