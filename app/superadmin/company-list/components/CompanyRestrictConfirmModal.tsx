"use client";

import { AlertTriangle } from "lucide-react";
import { PortalModal } from "../../components/ui";

type CompanyRestrictConfirmModalProps = {
  open: boolean;
  companyName: string | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function CompanyRestrictConfirmModal({
  open,
  companyName,
  loading,
  onClose,
  onConfirm,
}: CompanyRestrictConfirmModalProps) {
  return (
    <PortalModal
      open={open}
      onClose={onClose}
      title="Restrict Company"
      description="This action immediately suspends the company and all associated accounts."
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {loading ? "Restricting..." : "Confirm Restrict"}
          </button>
        </div>
      }
    >
      <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
        <div className="text-sm text-rose-900">
          <p className="font-semibold">
            Restrict <span className="text-rose-700">{companyName || "this company"}</span>?
          </p>
          <p className="mt-2 text-rose-800">
            The company will be marked as restricted immediately. All users and administrators under this company
            will have their accounts permanently suspended until manually unrestricted by a superadmin.
          </p>
        </div>
      </div>
    </PortalModal>
  );
}
