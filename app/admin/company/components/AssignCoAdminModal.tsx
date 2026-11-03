"use client";

import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { showToast } from "@/app/components/Toast";
import { ModalPortal } from "@/app/components/ModalPortal";
import { InlineLoader } from "@/app/components/Loader";
import {
  CO_ADMIN_PERMISSION_OPTIONS,
  companyAdminApiRequest,
  DEFAULT_CO_ADMIN_PERMISSIONS,
} from "../../lib/companyAdminApi";

type Props = {
  isOpen: boolean;
  employeeId: string;
  employeeName: string;
  coAdminCount: number;
  coAdminLimit: number;
  onClose: () => void;
  onSuccess: () => void;
};

export default function AssignCoAdminModal({
  isOpen,
  employeeId,
  employeeName,
  coAdminCount,
  coAdminLimit,
  onClose,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [permissions, setPermissions] = useState({ ...DEFAULT_CO_ADMIN_PERMISSIONS });
  const atLimit = coAdminCount >= coAdminLimit;

  useEffect(() => {
    if (!isOpen) return;
    setPermissions({ ...DEFAULT_CO_ADMIN_PERMISSIONS });
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await companyAdminApiRequest(`/api/company/employees/${employeeId}/role`, {
        method: "PUT",
        body: JSON.stringify({
          role: "admin",
          reason: "Assigned as co-admin",
          permissions,
        }),
      });
      showToast(`${employeeName} has been assigned as co-admin.`, "success");
      onSuccess();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to assign co-admin.", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalPortal isOpen={isOpen} onClose={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Assign as Co-Admin</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-3 text-sm text-gray-600">
          Assign <span className="font-semibold text-gray-900">{employeeName}</span> as a company co-admin.
          Their company role will become <span className="font-semibold">admin</span> and their BizCards will use the company theme.
        </p>
        <p className="mt-2 text-xs text-gray-500">
          Co-admins: {coAdminCount}/{coAdminLimit}
        </p>
        {atLimit && (
          <p className="mt-2 text-sm text-rose-700 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2">
            Co-admin limit reached. Demote an existing co-admin before assigning a new one.
          </p>
        )}
        <div className="mt-4 space-y-2">
          <p className="text-sm font-semibold text-gray-800">Permissions</p>
          {CO_ADMIN_PERMISSION_OPTIONS.map((option) => (
            <label
              key={option.key}
              className="flex items-start gap-2 rounded-xl border border-gray-100 px-3 py-2.5 text-sm text-gray-700"
            >
              <input
                type="checkbox"
                checked={permissions[option.key]}
                onChange={(e) =>
                  setPermissions((prev) => ({ ...prev, [option.key]: e.target.checked }))
                }
                className="mt-0.5 h-4 w-4 rounded border-gray-300"
              />
              <span>
                <span className="font-medium block">{option.label}</span>
                <span className="text-xs text-gray-500">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading || atLimit}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? <InlineLoader className="text-white" /> : "Confirm Assignment"}
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}
