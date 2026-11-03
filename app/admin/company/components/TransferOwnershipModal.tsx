"use client";

import React, { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { showToast } from "@/app/components/Toast";
import { showConfirmDialog } from "@/app/components/ConfirmDialog";
import { ModalPortal } from "@/app/components/ModalPortal";
import { InlineLoader } from "@/app/components/Loader";
import { companyAdminApiRequest } from "../../lib/companyAdminApi";

type Props = {
  isOpen: boolean;
  employeeId: string;
  employeeName: string;
  coAdminCount: number;
  coAdminLimit: number;
  onClose: () => void;
  onSuccess: () => void;
};

export default function TransferOwnershipModal({
  isOpen,
  employeeId,
  employeeName,
  coAdminCount,
  coAdminLimit,
  onClose,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false);
  const outgoingBecomesCoAdmin = coAdminCount < coAdminLimit;

  if (!isOpen) return null;

  const handleConfirm = async () => {
    const confirmed = await showConfirmDialog({
      title: "Transfer company ownership?",
      message: `You are about to make ${employeeName} the primary admin. This cannot be undone from this screen. Are you sure you want to continue?`,
      confirmLabel: "Transfer ownership",
      variant: "danger",
    });
    if (!confirmed) return;

    setLoading(true);
    try {
      await companyAdminApiRequest("/api/company/admin/transfer", {
        method: "POST",
        body: JSON.stringify({
          target_employee_id: employeeId,
          reason: "Primary admin ownership transfer",
        }),
      });
      showToast(`Ownership transferred to ${employeeName}.`, "success");
      onSuccess();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to transfer ownership.", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalPortal isOpen={isOpen} onClose={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Transfer Primary Admin</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              You are about to make <span className="font-semibold">{employeeName}</span> the primary company administrator.
              {outgoingBecomesCoAdmin
                ? ` You will become a co-admin (${coAdminCount + 1}/${coAdminLimit}).`
                : ` You will become an employee because the co-admin limit (${coAdminLimit}) has been reached.`}
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? <InlineLoader className="text-white" /> : "Transfer Ownership"}
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}
