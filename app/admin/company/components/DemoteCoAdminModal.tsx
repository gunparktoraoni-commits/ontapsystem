"use client";

import React, { useState } from "react";
import { X } from "lucide-react";
import { showToast } from "@/app/components/Toast";
import { ModalPortal } from "@/app/components/ModalPortal";
import { InlineLoader } from "@/app/components/Loader";
import { companyAdminApiRequest } from "../../lib/companyAdminApi";

type Props = {
  isOpen: boolean;
  employeeId: string;
  employeeName: string;
  onClose: () => void;
  onSuccess: () => void;
};

export default function DemoteCoAdminModal({
  isOpen,
  employeeId,
  employeeName,
  onClose,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await companyAdminApiRequest(`/api/company/employees/${employeeId}/role`, {
        method: "PUT",
        body: JSON.stringify({
          role: "employee",
          reason: "Demoted from co-admin to employee",
        }),
      });
      showToast(`${employeeName} has been demoted to employee.`, "success");
      onSuccess();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to demote co-admin.", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalPortal isOpen={isOpen} onClose={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Demote Co-Admin</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-3 text-sm text-gray-600">
          Demote <span className="font-semibold text-gray-900">{employeeName}</span> from co-admin back to employee?
          They will lose co-admin permissions but remain in the company.
        </p>
        <div className="mt-6 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? <InlineLoader className="text-white" /> : "Demote to Employee"}
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}
