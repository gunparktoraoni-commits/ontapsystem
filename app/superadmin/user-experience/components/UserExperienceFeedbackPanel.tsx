"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquare } from "lucide-react";
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
  PortalTableBody,
  PortalTableCell,
  PortalTableHead,
  PortalTableHeaderCell,
  PortalTableRow,
  PortalToastStack,
  PortalToolbar,
  usePortalToasts,
} from "../../components/ui";
import {
  EXPERIENCE_SURVEY_REVIEW_NEW,
  EXPERIENCE_SURVEY_REVIEW_REVIEWED,
} from "@/lib/portal/experience-survey";
import {
  fetchFeedbackList,
  updateFeedbackReviewStatus,
  type FeedbackRow,
} from "./userExperienceApi";
import {
  FeedbackDetailContent,
  formatFeedbackDate,
  ReviewStatusBadge,
  StarRatingDisplay,
  truncateText,
} from "./userExperienceShared";

type ReviewFilter = "all" | typeof EXPERIENCE_SURVEY_REVIEW_NEW | typeof EXPERIENCE_SURVEY_REVIEW_REVIEWED;
type RatingFilter = "all" | "1" | "2" | "3" | "4" | "5";

export default function UserExperienceFeedbackPanel() {
  const { toasts, push: pushToast, dismiss: dismissToast } = usePortalToasts();
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedRow, setSelectedRow] = useState<FeedbackRow | null>(null);
  const [markingReviewed, setMarkingReviewed] = useState(false);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFeedbackList({
        page,
        limit: 20,
        search,
        rating: ratingFilter === "all" ? "all" : Number(ratingFilter),
        review_status: reviewFilter,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setRows(data.rows);
      setPages(data.pagination.pages);
      setTotal(data.pagination.total);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load feedback.";
      setError(message);
      pushToast("error", message);
    } finally {
      setLoading(false);
    }
  }, [page, search, reviewFilter, ratingFilter, dateFrom, dateTo, pushToast]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    setPage(1);
  }, [search, reviewFilter, ratingFilter, dateFrom, dateTo]);

  const filters = useMemo(
    () => [
      {
        id: "review-all",
        label: "All status",
        active: reviewFilter === "all",
        onClick: () => setReviewFilter("all"),
      },
      {
        id: "review-new",
        label: "New",
        active: reviewFilter === EXPERIENCE_SURVEY_REVIEW_NEW,
        onClick: () => setReviewFilter(EXPERIENCE_SURVEY_REVIEW_NEW),
      },
      {
        id: "review-reviewed",
        label: "Reviewed",
        active: reviewFilter === EXPERIENCE_SURVEY_REVIEW_REVIEWED,
        onClick: () => setReviewFilter(EXPERIENCE_SURVEY_REVIEW_REVIEWED),
      },
      ...(["1", "2", "3", "4", "5"] as const).map((rating) => ({
        id: `rating-${rating}`,
        label: `${rating}★`,
        active: ratingFilter === rating,
        onClick: () => setRatingFilter((prev) => (prev === rating ? "all" : rating)),
      })),
    ],
    [reviewFilter, ratingFilter],
  );

  const handleMarkReviewed = async () => {
    if (!selectedRow) return;
    setMarkingReviewed(true);
    try {
      const updated = await updateFeedbackReviewStatus(
        selectedRow.survey_id,
        EXPERIENCE_SURVEY_REVIEW_REVIEWED,
      );
      setSelectedRow(updated);
      setRows((prev) => prev.map((row) => (row.survey_id === updated.survey_id ? updated : row)));
      pushToast("success", "Feedback marked as reviewed.");
    } catch (err) {
      pushToast(
        "error",
        err instanceof Error ? err.message : "Failed to update feedback status.",
      );
    } finally {
      setMarkingReviewed(false);
    }
  };

  return (
    <div className="space-y-6">
      <PortalPageHeader
        title="Feedback"
        subtitle="Review and manage experience feedback submitted by user portal users."
      />

      <PortalToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search feedback, users, or emails…"
        filters={filters}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-11 rounded-lg border border-gray-200 px-3 text-sm text-gray-700"
              aria-label="Filter from date"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-11 rounded-lg border border-gray-200 px-3 text-sm text-gray-700"
              aria-label="Filter to date"
            />
          </div>
        }
      />

      {error && !loading ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <PortalPanel title={`Feedback (${total})`}>
        {loading ? (
          <div className="flex justify-center py-16">
            <InlineLoader />
          </div>
        ) : rows.length === 0 ? (
          <PortalEmptyState
            title="No feedback yet"
            description="User feedback will appear here once users submit their experience."
            icon={MessageSquare}
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
                  {rows.map((row) => (
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
              {rows.map((row) => (
                <PortalMobileCard key={row.survey_id} onClick={() => setSelectedRow(row)}>
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

            {pages > 1 ? (
              <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4">
                <p className="text-sm text-gray-500">
                  Page {page} of {pages}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={page >= pages}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
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
