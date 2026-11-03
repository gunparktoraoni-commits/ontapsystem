"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Lightbulb } from "lucide-react";
import { InlineLoader } from "@/app/components/Loader";
import {
  EXPERIENCE_SURVEY_FEATURE_STATUSES,
} from "@/lib/portal/experience-survey";
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
  fetchFeatureRequestsList,
  updateFeatureRequestStatus,
  type FeedbackRow,
} from "./userExperienceApi";
import {
  FeatureRequestStatusBadge,
  FEATURE_STATUS_OPTIONS,
  formatFeedbackDate,
  StarRatingDisplay,
  truncateText,
} from "./userExperienceShared";

type FeatureStatusFilter = "all" | (typeof EXPERIENCE_SURVEY_FEATURE_STATUSES)[number];

export default function UserExperienceFeatureRequestsPanel() {
  const { toasts, push: pushToast, dismiss: dismissToast } = usePortalToasts();
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FeatureStatusFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedRow, setSelectedRow] = useState<FeedbackRow | null>(null);
  const [pendingStatus, setPendingStatus] = useState<string>("");
  const [savingStatus, setSavingStatus] = useState(false);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFeatureRequestsList({
        page,
        limit: 20,
        search,
        feature_request_status: statusFilter,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setRows(data.rows);
      setPages(data.pagination.pages);
      setTotal(data.pagination.total);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load feature requests.";
      setError(message);
      pushToast("error", message);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, dateFrom, dateTo, pushToast]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (selectedRow) {
      setPendingStatus(selectedRow.feature_request_status ?? "new");
    }
  }, [selectedRow]);

  const filters = useMemo(
    () => [
      {
        id: "status-all",
        label: "All",
        active: statusFilter === "all",
        onClick: () => setStatusFilter("all"),
      },
      ...EXPERIENCE_SURVEY_FEATURE_STATUSES.map((status) => ({
        id: `status-${status}`,
        label: FEATURE_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status,
        active: statusFilter === status,
        onClick: () => setStatusFilter(status),
      })),
    ],
    [statusFilter],
  );

  const handleSaveStatus = async () => {
    if (!selectedRow || !pendingStatus) return;
    setSavingStatus(true);
    try {
      const updated = await updateFeatureRequestStatus(selectedRow.survey_id, pendingStatus);
      setSelectedRow(updated);
      setRows((prev) => prev.map((row) => (row.survey_id === updated.survey_id ? updated : row)));
      pushToast("success", "Feature request status updated.");
    } catch (err) {
      pushToast(
        "error",
        err instanceof Error ? err.message : "Failed to update feature request status.",
      );
    } finally {
      setSavingStatus(false);
    }
  };

  return (
    <div className="space-y-6">
      <PortalPageHeader
        title="Feature Requests"
        subtitle="Track user-submitted feature suggestions from the experience survey."
      />

      <PortalToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search suggestions or users…"
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

      <PortalPanel title={`Feature Requests (${total})`}>
        {loading ? (
          <div className="flex justify-center py-16">
            <InlineLoader />
          </div>
        ) : rows.length === 0 ? (
          <PortalEmptyState
            title="No feature requests yet"
            description="Feature suggestions will appear here once users submit them through the experience survey."
            icon={Lightbulb}
          />
        ) : (
          <>
            <div className="hidden md:block">
              <PortalDataTable>
                <PortalTableHead>
                  <PortalTableRow>
                    <PortalTableHeaderCell>Request</PortalTableHeaderCell>
                    <PortalTableHeaderCell>User</PortalTableHeaderCell>
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
                      <PortalTableCell className="max-w-md font-medium text-gray-900">
                        {truncateText(row.feature_suggestion, 100)}
                      </PortalTableCell>
                      <PortalTableCell>
                        <div className="font-medium text-gray-900">{row.user_name}</div>
                        <div className="text-xs text-gray-500">{row.user_email}</div>
                      </PortalTableCell>
                      <PortalTableCell className="whitespace-nowrap text-gray-600">
                        {formatFeedbackDate(row.created_at)}
                      </PortalTableCell>
                      <PortalTableCell>
                        <FeatureRequestStatusBadge status={row.feature_request_status} />
                      </PortalTableCell>
                    </PortalTableRow>
                  ))}
                </PortalTableBody>
              </PortalDataTable>
            </div>

            <PortalMobileCardList className="md:hidden">
              {rows.map((row) => (
                <PortalMobileCard key={row.survey_id} onClick={() => setSelectedRow(row)}>
                  <PortalMobileCardRow
                    label="Request"
                    value={truncateText(row.feature_suggestion, 60)}
                  />
                  <PortalMobileCardRow label="User" value={row.user_name} />
                  <PortalMobileCardRow label="Date" value={formatFeedbackDate(row.created_at)} />
                  <PortalMobileCardRow
                    label="Status"
                    value={<FeatureRequestStatusBadge status={row.feature_request_status} />}
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
        title="Feature Request Details"
        size="lg"
      >
        {selectedRow ? (
          <div className="space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Request</p>
              <p className="mt-2 whitespace-pre-wrap rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-800">
                {selectedRow.feature_suggestion?.trim() || "—"}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">User</p>
                <p className="mt-1 text-sm font-medium text-gray-900">{selectedRow.user_name}</p>
                <p className="text-sm text-gray-600">{selectedRow.user_email}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Submitted</p>
                <p className="mt-1 text-sm text-gray-900">{formatFeedbackDate(selectedRow.created_at)}</p>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Rating</p>
              <div className="mt-2">
                <StarRatingDisplay rating={selectedRow.rating} size="md" />
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Example Feedback
              </p>
              <p className="mt-2 whitespace-pre-wrap rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-800">
                {selectedRow.feedback?.trim() || "No additional feedback provided."}
              </p>
            </div>

            <div>
              <label htmlFor="feature-request-status" className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Status
              </label>
              <select
                id="feature-request-status"
                value={pendingStatus}
                onChange={(e) => setPendingStatus(e.target.value)}
                className="mt-2 h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-800"
              >
                {FEATURE_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end border-t border-gray-100 pt-4">
              <button
                type="button"
                onClick={handleSaveStatus}
                disabled={savingStatus || pendingStatus === selectedRow.feature_request_status}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingStatus ? "Saving…" : "Update Status"}
              </button>
            </div>
          </div>
        ) : null}
      </PortalModal>

      <PortalToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
