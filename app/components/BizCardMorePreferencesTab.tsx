"use client";



import React from "react";
import { AtSign, Settings } from "lucide-react";
import { showConfirmDialog } from "./ConfirmDialog";

export interface MorePreferencesTabProps {
  showCoverPhoto?: boolean;
  setShowCoverPhoto?: React.Dispatch<React.SetStateAction<boolean>>;
  showInquiryCard?: boolean;
  setShowInquiryCard?: React.Dispatch<React.SetStateAction<boolean>>;
  showAssociateCount?: boolean;
  setShowAssociateCount?: React.Dispatch<React.SetStateAction<boolean>>;
  showMutualAssociates?: boolean;
  setShowMutualAssociates?: React.Dispatch<React.SetStateAction<boolean>>;
  showEmail?: boolean;
  setShowEmail?: React.Dispatch<React.SetStateAction<boolean>>;
}

async function confirmPreferenceChange(
  nextEnabled: boolean,
  opts: { enableTitle: string; disableTitle: string; enableMessage: string; disableMessage: string },
): Promise<boolean> {
  return showConfirmDialog({
    title: nextEnabled ? opts.enableTitle : opts.disableTitle,
    message: nextEnabled ? opts.enableMessage : opts.disableMessage,
    confirmLabel: nextEnabled ? "Enable" : "Disable",
    cancelLabel: "Cancel",
    variant: nextEnabled ? "primary" : "warning",
  });
}

export default function MorePreferencesTab({
  showCoverPhoto = true,
  setShowCoverPhoto,
  showInquiryCard = true,
  setShowInquiryCard,
  showAssociateCount = false,
  setShowAssociateCount,
  showMutualAssociates = false,
  setShowMutualAssociates,
  showEmail = true,
  setShowEmail,
}: MorePreferencesTabProps) {
  const toggleCover = async () => {
    if (!setShowCoverPhoto) return;
    const next = !showCoverPhoto;
    const ok = await confirmPreferenceChange(next, {
      enableTitle: "Show cover photo",
      disableTitle: "Hide cover photo",
      enableMessage: "Show the cover image at the top of your portfolio?",
      disableMessage: "Hide the cover image from your public portfolio?",
    });
    if (ok) setShowCoverPhoto(next);
  };

  const toggleInquiry = async () => {
    if (!setShowInquiryCard) return;
    const next = !showInquiryCard;
    const ok = await confirmPreferenceChange(next, {
      enableTitle: "Show inquiry card",
      disableTitle: "Hide inquiry card",
      enableMessage: "Show the inquiry card on your public portfolio?",
      disableMessage: "Hide the inquiry card from your public portfolio?",
    });
    if (ok) setShowInquiryCard(next);
  };

  const toggleAssociateCount = async () => {
    if (!setShowAssociateCount) return;
    const next = !showAssociateCount;
    const ok = await confirmPreferenceChange(next, {
      enableTitle: "Show associate count",
      disableTitle: "Hide associate count",
      enableMessage: "Show your associate count on your public portfolio?",
      disableMessage: "Hide your associate count from your public portfolio?",
    });
    if (ok) setShowAssociateCount(next);
  };

  const toggleMutualAssociates = async () => {
    if (!setShowMutualAssociates) return;
    const next = !showMutualAssociates;
    const ok = await confirmPreferenceChange(next, {
      enableTitle: "Show mutual associates",
      disableTitle: "Hide mutual associates",
      enableMessage: "Show mutual associates on your public portfolio?",
      disableMessage: "Hide mutual associates from your public portfolio?",
    });
    if (ok) setShowMutualAssociates(next);
  };

  const toggleEmail = async () => {
    if (!setShowEmail) return;
    const next = !showEmail;
    const ok = await confirmPreferenceChange(next, {
      enableTitle: "Show email address",
      disableTitle: "Hide email address",
      enableMessage: "Show your email address on your public portfolio?",
      disableMessage: "Hide your email address from your public portfolio? Visitors will no longer see it in any theme.",
    });
    if (ok) setShowEmail(next);
  };

  return (
    <div className="space-y-5">
      <div className="bg-linear-to-br from-slate-50 to-blue-50/50 rounded-2xl border border-slate-100 p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-xl bg-linear-to-br from-slate-600 to-slate-700 flex items-center justify-center shadow-lg shadow-slate-600/20">
            <Settings className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-slate-900 mb-1">
              Display Preferences
            </h2>
            <p className="text-sm text-slate-500">
              Choose which components to display on your portfolio
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {/* Cover Photo Toggle */}
        <div className="flex items-center justify-between p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors bg-white">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center">
              <svg
                className="h-5 w-5 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Cover Photo</h3>
              <p className="text-sm text-slate-500">
                Display your cover image at the top of the portfolio
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void toggleCover()}
            className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
              showCoverPhoto
                ? "bg-emerald-500 hover:bg-emerald-600"
                : "bg-slate-300 hover:bg-slate-400"
            }`}
            role="switch"
            aria-checked={showCoverPhoto}
            aria-pressed={showCoverPhoto}
            aria-label="Toggle cover photo display"
          >
            <span
              className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-md transition-transform ${
                showCoverPhoto ? "translate-x-7" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {/* Inquiry Card Toggle */}
        <div className="flex items-center justify-between p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors bg-white">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-purple-100 to-purple-200 flex items-center justify-center">
              <svg
                className="h-5 w-5 text-purple-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Inquiry Card</h3>
              <p className="text-sm text-slate-500">
                Show the contact form for visitors to send inquiries
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void toggleInquiry()}
            className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
              showInquiryCard
                ? "bg-emerald-500 hover:bg-emerald-600"
                : "bg-slate-300 hover:bg-slate-400"
            }`}
            role="switch"
            aria-checked={showInquiryCard}
            aria-label="Toggle inquiry card display"
          >
            <span
              className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-md transition-transform ${
                showInquiryCard ? "translate-x-7" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {/* Email Address Toggle */}
        <div className="flex items-center justify-between p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors bg-white">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-sky-100 to-sky-200 flex items-center justify-center">
              <AtSign className="h-5 w-5 text-sky-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Email Address</h3>
              <p className="text-sm text-slate-500">
                Show your email address on your portfolio
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void toggleEmail()}
            className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
              showEmail
                ? "bg-emerald-500 hover:bg-emerald-600"
                : "bg-slate-300 hover:bg-slate-400"
            }`}
            role="switch"
            aria-checked={showEmail}
            aria-label="Toggle email address display"
          >
            <span
              className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-md transition-transform ${
                showEmail ? "translate-x-7" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {/* Associate Count Toggle */}
        <div className="flex items-center justify-between p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors bg-white">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-emerald-100 to-emerald-200 flex items-center justify-center">
              <svg
                className="h-5 w-5 text-emerald-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Associate Count</h3>
              <p className="text-sm text-slate-500">
                Show how many associates you have, e.g. 500+ Associates
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void toggleAssociateCount()}
            className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
              showAssociateCount
                ? "bg-emerald-500 hover:bg-emerald-600"
                : "bg-slate-300 hover:bg-slate-400"
            }`}
            role="switch"
            aria-checked={showAssociateCount}
            aria-label="Toggle associate count display"
          >
            <span
              className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-md transition-transform ${
                showAssociateCount ? "translate-x-7" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {/* Mutual Associates Toggle */}
        <div className="flex items-center justify-between p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors bg-white">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-amber-100 to-amber-200 flex items-center justify-center">
              <svg
                className="h-5 w-5 text-amber-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Mutual Associates</h3>
              <p className="text-sm text-slate-500">
                Let signed-in visitors see associates you have in common
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void toggleMutualAssociates()}
            className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
              showMutualAssociates
                ? "bg-emerald-500 hover:bg-emerald-600"
                : "bg-slate-300 hover:bg-slate-400"
            }`}
            role="switch"
            aria-checked={showMutualAssociates}
            aria-label="Toggle mutual associates display"
          >
            <span
              className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-md transition-transform ${
                showMutualAssociates ? "translate-x-7" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
