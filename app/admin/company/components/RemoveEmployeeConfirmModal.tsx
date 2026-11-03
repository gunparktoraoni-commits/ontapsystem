"use client";

import React, { useState } from "react";
import { X } from "lucide-react";
import { companyAdminApiRequest } from "../../lib/companyAdminApi";
import { ModalPortal } from "../../../components/ModalPortal";
import { InlineLoader } from "../../../components/Loader";

type Props = {
  isOpen: boolean;
  employeeName: string;
  onClose: () => void;
  onConfirm: (reason?: string) => Promise<void>;
};

export default function RemoveEmployeeConfirmModal({
  isOpen,
  employeeName,
  onClose,
  onConfirm,
}: Props) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm(reason.trim() || undefined);
      setReason("");
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalPortal isOpen={isOpen} onClose={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Remove from Company</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-3 text-sm text-gray-600">
          Are you sure you want to remove <span className="font-semibold text-gray-900">{employeeName}</span> from your company? Their company access will be restricted.
        </p>
        <label className="mt-4 block text-sm font-medium text-gray-700">
          Reason (optional)
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            placeholder="Optional reason for removal..."
          />
        </label>
        <div className="mt-6 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? <InlineLoader className="text-white" /> : "Remove Employee"}
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}

export function useRemoveEmployee() {
  return async (employeeId: string, reason?: string) => {
    await companyAdminApiRequest(`/api/company/employees/${employeeId}/restrict`, {
      method: "POST",
      body: JSON.stringify({
        action: "restrict",
        reason: reason || "Removed by company admin",
      }),
    });
  };
}
