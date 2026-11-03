"use client";

import React, { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { X } from "lucide-react";
import { showToast } from "../../../components/Toast";
import { showInputDialog } from "../../../components/InputDialog";
import {
  companyAdminApiRequest,
  normalizeResponseData,
} from "../../lib/companyAdminApi";
import { InlineLoader } from "../../../components/Loader";
import { ModalPortal } from "../../../components/ModalPortal";

export type JoinRequest = {
  id: string;
  name: string;
  email: string;
  requestedAt: string;
};

type JoinRequestsResponseData = {
  requests?: Array<Record<string, unknown>>;
  join_requests?: Array<Record<string, unknown>>;
};

type JoinRequestsResponse = { data?: JoinRequestsResponseData } & JoinRequestsResponseData;

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: (pendingCount: number) => void;
};

export default function JoinRequestsModal({ isOpen, onClose, onUpdated }: Props) {
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionState, setActionState] = useState<Record<string, "approve" | "reject" | undefined>>({});

  const fetchJoinRequests = useCallback(async () => {
    setLoading(true);
    try {
      const payload = (await companyAdminApiRequest(
        "/api/company/join-requests?status=pending&limit=50",
      )) as JoinRequestsResponse;
      const data = normalizeResponseData<JoinRequestsResponseData>(payload);
      const rows = Array.isArray(data.requests)
        ? data.requests
        : Array.isArray(data.join_requests)
          ? data.join_requests
          : [];
      const mapped: JoinRequest[] = rows.map((row) => {
        const user = (row.user ?? row.requester ?? row.created_by ?? {}) as Record<string, unknown>;
        return {
          id: String(row.request_id ?? row.id ?? ""),
          name: String(user.name ?? row.requester_name ?? "Unknown"),
          email: String(user.email ?? row.requester_email ?? ""),
          requestedAt: String(row.created_at ?? row.requested_at ?? new Date().toISOString()),
        };
      });
      setJoinRequests(mapped);
      onUpdated?.(mapped.length);
    } catch {
      setJoinRequests([]);
      onUpdated?.(0);
    } finally {
      setLoading(false);
    }
  }, [onUpdated]);

  useEffect(() => {
    if (isOpen) void fetchJoinRequests();
  }, [isOpen, fetchJoinRequests]);

  const handleReview = async (request: JoinRequest, action: "approve" | "reject") => {
    setActionState((prev) => ({ ...prev, [request.id]: action }));
    try {
      let rejectionReason: string | undefined;
      if (action === "reject") {
        const result = await showInputDialog({
          title: "Reject Join Request",
          description: `You are about to reject ${request.name}'s request to join. You may provide an optional reason that will be shared with them.`,
          fields: [
            {
              key: "reason",
              label: "Rejection Reason",
              placeholder: "e.g. Your account is already registered under a different company.",
              type: "textarea",
            },
          ],
          submitLabel: "Confirm Rejection",
          cancelLabel: "Go Back",
        });
        if (result === null) {
          setActionState((prev) => ({ ...prev, [request.id]: undefined }));
          return;
        }
        rejectionReason = result.reason?.trim() || undefined;
      }

      await companyAdminApiRequest("/api/company/join-requests/approve", {
        method: "POST",
        body: JSON.stringify({
          request_id: request.id,
          action,
          rejection_reason: rejectionReason,
        }),
      });

      showToast(`Join request ${action === "approve" ? "approved" : "rejected"}.`, "success");
      await fetchJoinRequests();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : `Failed to ${action} request.`,
        "error",
      );
    } finally {
      setActionState((prev) => ({ ...prev, [request.id]: undefined }));
    }
  };

  return (
    <ModalPortal isOpen={isOpen} onClose={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Pending Join Requests</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 space-y-3 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-gray-400">
              <InlineLoader />
            </div>
          ) : joinRequests.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No pending join requests.</p>
          ) : (
            joinRequests.map((request) => (
              <div
                key={request.id}
                className="flex flex-col gap-3 rounded-xl border border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-semibold text-gray-800">{request.name}</p>
                  <p className="text-xs text-gray-500">{request.email}</p>
                  <p className="text-xs text-gray-400">
                    Requested {format(new Date(request.requestedAt), "MMM d, yyyy")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleReview(request, "approve")}
                    disabled={actionState[request.id] === "approve"}
                    className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {actionState[request.id] === "approve" ? "Approving..." : "Approve"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReview(request, "reject")}
                    disabled={actionState[request.id] === "reject"}
                    className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 disabled:opacity-60"
                  >
                    {actionState[request.id] === "reject" ? "Rejecting..." : "Reject"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
