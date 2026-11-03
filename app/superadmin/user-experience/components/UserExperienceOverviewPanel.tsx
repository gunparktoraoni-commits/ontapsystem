"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3, Lightbulb, MessageSquare, Star, TrendingUp } from "lucide-react";
import { InlineLoader } from "@/app/components/Loader";
import {
  PortalDataTable,
  PortalEmptyState,
  PortalMobileCard,
  PortalMobileCardList,
  PortalMobileCardRow,
  PortalModal,
  PortalPageHeader,
  PortalPanel,
  PortalStatCard,
  PortalTableBody,
  PortalTableCell,
  PortalTableHead,
  PortalTableHeaderCell,
  PortalTableRow,
  PortalToastStack,
  usePortalToasts,
} from "../../components/ui";
import {
  EXPERIENCE_SURVEY_REVIEW_REVIEWED,
} from "@/lib/portal/experience-survey";
import {
  fetchOverview,
  updateFeedbackReviewStatus,
  type FeedbackRow,
  type OverviewMetrics,
} from "./userExperienceApi";
import {
  FeedbackDetailContent,
  formatFeedbackDate,
  ReviewStatusBadge,
  StarRatingDisplay,
  truncateText,
} from "./userExperienceShared";

export default function UserExperienceOverviewPanel() {
  const { toasts, push: pushToast, dismiss: dismissToast } = usePortalToasts();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [recentFeedback, setRecentFeedback] = useState<FeedbackRow[]>([]);
  const [selectedRow, setSelectedRow] = useState<FeedbackRow | null>(null);
  const [markingReviewed, setMarkingReviewed] = useState(false);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOverview();
      setMetrics(data.metrics);
      setRecentFeedback(data.recent_feedback);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load overview.";
      setError(message);
      pushToast("error", message);
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const handleMarkReviewed = async () => {
    if (!selectedRow) return;
    setMarkingReviewed(true);
    try {
      const updated = await updateFeedbackReviewStatus(
        selectedRow.survey_id,
        EXPERIENCE_SURVEY_REVIEW_REVIEWED,
      );
      setSelectedRow(updated);
      setRecentFeedback((prev) =>
        prev.map((row) => (row.survey_id === updated.survey_id ? updated : row)),
      );
      pushToast("success", "Feedback marked as reviewed.");
      void loadOverview();
    } catch (err) {
      pushToast(
        "error",
        err instanceof Error ? err.message : "Failed to update feedback status.",
      );
    } finally {
      setMarkingReviewed(false);
    }
  };

  const averageRatingLabel =
    metrics?.average_rating != null ? `${metrics.average_rating.toFixed(1)} / 5` : "—";

  return (
    <div className="space-y-6">
      <PortalPageHeader
        title="User Experience Overview"
        subtitle="Monitor real user feedback, ratings, and feature suggestions from the user portal survey."
        actions={
          <Link
            href="/superadmin/user-experience/feedback"
            className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:border-primary/30 hover:text-primary"
          >
            View all feedback
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PortalStatCard
          label="Total Feedback"
          value={metrics ? String(metrics.total_feedback) : "—"}
          icon={MessageSquare}
          loading={loading}
        />
        <PortalStatCard
          label="Average Rating"
          value={averageRatingLabel}
          icon={Star}
          loading={loading}
        />
        <PortalStatCard
          label="Feature Suggestions"
          value={metrics ? String(metrics.feature_suggestions) : "—"}
          icon={Lightbulb}
          loading={loading}
        />
        <PortalStatCard
          label="This Month"
          value={metrics ? `+${metrics.feedback_this_month}` : "—"}
          icon={TrendingUp}
          loading={loading}
        />
      </div>

      {error && !loading ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <PortalPanel title="Recent Feedback">
        {loading ? (
          <div className="flex justify-center py-16">
            <InlineLoader />
          </div>
        ) : recentFeedback.length === 0 ? (
          <PortalEmptyState
            title="No feedback yet"
            description="User feedback will appear here once users submit their experience."
            icon={BarChart3}
          />
        ) : (
          <>
            <div className="hidden md:block">
              <PortalDataTable>
                <PortalTableHead>
                  <PortalTableRow>
                    <PortalTableHeaderCell>User</PortalTableHeaderCell>
                    <PortalTableHeaderCell>Rating</PortalTableHeaderCell>
                    <PortalTableHeaderCell>Feedback</PortalTableHeaderCell>
                    <PortalTableHeaderCell>Suggestion</PortalTableHeaderCell>
                    <PortalTableHeaderCell>Date</PortalTableHeaderCell>
                    <PortalTableHeaderCell>Status</PortalTableHeaderCell>
                  </PortalTableRow>
                </PortalTableHead>
                <PortalTableBody>
                  {recentFeedback.map((row) => (
                    <PortalTableRow
                      key={row.survey_id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => setSelectedRow(row)}
                    >
                      <PortalTableCell>
                        <div className="font-medium text-gray-900">{row.user_name}</div>
                        <div className="text-xs text-gray-500">{row.user_email}</div>
                      </PortalTableCell>
                      <PortalTableCell>
                        <StarRatingDisplay rating={row.rating} />
                      </PortalTableCell>
                      <PortalTableCell className="max-w-xs text-gray-700">
                        {truncateText(row.feedback)}
                      </PortalTableCell>
                      <PortalTableCell className="max-w-xs text-gray-700">
                        {truncateText(row.feature_suggestion)}
                      </PortalTableCell>
                      <PortalTableCell className="whitespace-nowrap text-gray-600">
                        {formatFeedbackDate(row.created_at)}
                      </PortalTableCell>
                      <PortalTableCell>
                        <ReviewStatusBadge status={row.review_status} />
                      </PortalTableCell>
                    </PortalTableRow>
                  ))}
                </PortalTableBody>
              </PortalDataTable>
            </div>

            <PortalMobileCardList className="md:hidden">
              {recentFeedback.map((row) => (
                <PortalMobileCard
                  key={row.survey_id}
                  onClick={() => setSelectedRow(row)}
                >
                  <PortalMobileCardRow label="User" value={row.user_name} />
                  <PortalMobileCardRow
                    label="Rating"
                    value={<StarRatingDisplay rating={row.rating} />}
                  />
                  <PortalMobileCardRow label="Feedback" value={truncateText(row.feedback, 60)} />
                  <PortalMobileCardRow label="Date" value={formatFeedbackDate(row.created_at)} />
                  <PortalMobileCardRow
                    label="Status"
                    value={<ReviewStatusBadge status={row.review_status} />}
                  />
                </PortalMobileCard>
              ))}
            </PortalMobileCardList>
          </>
        )}
      </PortalPanel>

      <PortalModal
        open={!!selectedRow}
        onClose={() => setSelectedRow(null)}
        title="Feedback Details"
        size="lg"
      >
        {selectedRow ? (
          <FeedbackDetailContent
            row={selectedRow}
            onMarkReviewed={handleMarkReviewed}
            markingReviewed={markingReviewed}
          />
        ) : null}
      </PortalModal>

      <PortalToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
