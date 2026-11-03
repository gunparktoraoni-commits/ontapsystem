"use client";

import React, { useMemo, useState } from "react";
import { X } from "lucide-react";
import { showToast } from "../../../components/Toast";
import { companyAdminApiRequest } from "../../lib/companyAdminApi";
import { ModalPortal } from "../../../components/ModalPortal";
import { InlineLoader } from "../../../components/Loader";

type Props = {
  isOpen: boolean;
  employeeId: string;
  employeeName: string;
  companyName: string;
  onClose: () => void;
  onSuccess: () => void;
};

export default function RestrictionRequestModal({
  isOpen,
  employeeId,
  employeeName,
  companyName,
  onClose,
  onSuccess,
}: Props) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const subject = useMemo(
    () => `Account Restriction Request — ${employeeName} (${companyName})`,
    [employeeName, companyName],
  );

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!message.trim()) {
      showToast("Please provide a message for the restriction request.", "error");
      return;
    }
    setLoading(true);
    try {
      await companyAdminApiRequest(
        `/api/company/employees/${employeeId}/restriction-request`,
        {
          method: "POST",
          body: JSON.stringify({ message: message.trim() }),
        },
      );
      showToast("Restriction request submitted successfully.", "success");
      setMessage("");
      onSuccess();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to submit request.", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalPortal isOpen={isOpen} onClose={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Request Account Restriction</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700">Subject</label>
            <input
              readOnly
              value={subject}
              className="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="Describe why this account restriction is being requested..."
            />
          </div>
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? <InlineLoader className="text-white" /> : "Submit Request"}
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}
