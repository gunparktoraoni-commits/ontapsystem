"use client";

import { Star } from "lucide-react";
import {
  EXPERIENCE_SURVEY_FEATURE_STATUSES,
  EXPERIENCE_SURVEY_REVIEW_REVIEWED,
  formatExperienceSurveyFeatureStatusLabel,
  formatExperienceSurveyReviewStatusLabel,
} from "@/lib/portal/experience-survey";
import { PortalBadge, statusToBadgeVariant } from "../../components/ui";
import type { FeedbackRow } from "./userExperienceApi";

export function formatFeedbackDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function truncateText(value: string | null | undefined, max = 80): string {
  if (!value?.trim()) return "—";
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function StarRatingDisplay({
  rating,
  size = "sm",
}: {
  rating: number | null | undefined;
  size?: "sm" | "md";
}) {
  const value = rating ?? 0;
  const iconClass = size === "md" ? "h-5 w-5" : "h-4 w-4";

  return (
    <div className="inline-flex items-center gap-0.5" aria-label={`${value} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, index) => {
        const filled = index < value;
        return (
          <Star
            key={index}
            className={`${iconClass} ${filled ? "fill-amber-400 text-amber-400" : "text-gray-300"}`}
            aria-hidden
          />
        );
      })}
    </div>
  );
}

export function ReviewStatusBadge({ status }: { status: string | null | undefined }) {
  const label = formatExperienceSurveyReviewStatusLabel(status);
  const variant =
    status === EXPERIENCE_SURVEY_REVIEW_REVIEWED ? "success" : statusToBadgeVariant(status);
  return <PortalBadge variant={variant}>{label}</PortalBadge>;
}

export function FeatureRequestStatusBadge({ status }: { status: string | null | undefined }) {
  const label = formatExperienceSurveyFeatureStatusLabel(status);
  return <PortalBadge variant={statusToBadgeVariant(status)}>{label}</PortalBadge>;
}

export const FEATURE_STATUS_OPTIONS = EXPERIENCE_SURVEY_FEATURE_STATUSES.map((value) => ({
  value,
  label: formatExperienceSurveyFeatureStatusLabel(value),
}));

export type FeedbackDetailModalProps = {
  row: FeedbackRow | null;
  open: boolean;
  onClose: () => void;
  onMarkReviewed?: () => void;
  markingReviewed?: boolean;
  showFeatureSection?: boolean;
};

export function FeedbackDetailContent({
  row,
  onMarkReviewed,
  markingReviewed,
  showFeatureSection = true,
}: {
  row: FeedbackRow;
  onMarkReviewed?: () => void;
  markingReviewed?: boolean;
  showFeatureSection?: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <StarRatingDisplay rating={row.rating} size="md" />
        <ReviewStatusBadge status={row.review_status} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">User</p>
          <p className="mt-1 text-sm font-medium text-gray-900">{row.user_name}</p>
          <p className="text-sm text-gray-600">{row.user_email}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Submitted</p>
          <p className="mt-1 text-sm text-gray-900">{formatFeedbackDate(row.created_at)}</p>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Experience Feedback
        </p>
        <p className="mt-2 whitespace-pre-wrap rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-800">
          {row.feedback?.trim() || "No written feedback provided."}
        </p>
      </div>

      {showFeatureSection ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Feature Suggestion
          </p>
          <p className="mt-2 whitespace-pre-wrap rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-800">
            {row.feature_suggestion?.trim() || "No feature suggestion provided."}
          </p>
        </div>
      ) : null}

      {onMarkReviewed && row.review_status !== EXPERIENCE_SURVEY_REVIEW_REVIEWED ? (
        <div className="flex justify-end border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={onMarkReviewed}
            disabled={markingReviewed}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {markingReviewed ? "Updating…" : "Mark as Reviewed"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
