"use client";

import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { showToast } from "@/app/components/Toast";
import { ModalPortal } from "@/app/components/ModalPortal";
import { InlineLoader } from "@/app/components/Loader";
import { companyAdminApiRequest, type EmployeePreviewRow } from "../../lib/companyAdminApi";

type Props = {
  employee: EmployeePreviewRow | null;
  actorIsPrimaryAdmin: boolean;
  targetIsCoAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export default function EditEmployeeDetailsModal({
  employee,
  actorIsPrimaryAdmin,
  targetIsCoAdmin,
  onClose,
  onSaved,
}: Props) {
  const [editRoleOption, setEditRoleOption] = useState<"admin" | "manager" | "employee" | "viewer" | "other">("employee");
  const [editCustomRole, setEditCustomRole] = useState("");
  const [editStatus, setEditStatus] = useState<"Active" | "Suspended">("Active");
  const [editReason, setEditReason] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!employee) return;
    const normalizedRole = employee.role.toLowerCase();
    if (
      normalizedRole === "admin" ||
      normalizedRole === "manager" ||
      normalizedRole === "employee" ||
      normalizedRole === "viewer"
    ) {
      setEditRoleOption(normalizedRole);
      setEditCustomRole("");
    } else {
      setEditRoleOption("other");
      setEditCustomRole(employee.role);
    }
    setEditStatus(
      employee.status === "Pending Invite" || employee.status === "Invite Expired"
        ? "Active"
        : employee.status,
    );
    setEditReason("");
  }, [employee]);

  if (!employee) return null;

  const roleLocked = targetIsCoAdmin && !actorIsPrimaryAdmin;

  const handleSave = async () => {
    setLoading(true);
    try {
      let nextRole =
        editRoleOption === "other"
          ? editCustomRole.trim().toLowerCase().replace(/\s+/g, " ")
          : editRoleOption;

      if (!roleLocked) {
        if (editRoleOption === "other") {
          if (!nextRole) {
            showToast("Please enter a custom role.", "error");
            setLoading(false);
            return;
          }
          if (nextRole.length > 20 || !/^[a-z0-9]+(?:[ _-][a-z0-9]+)*$/i.test(nextRole)) {
            showToast(
              "Custom role must be at most 20 characters and use letters, numbers, spaces, or hyphens.",
              "error",
            );
            setLoading(false);
            return;
          }
        }

        if (nextRole !== employee.role.toLowerCase()) {
          await companyAdminApiRequest(`/api/company/employees/${employee.id}/role`, {
            method: "PUT",
            body: JSON.stringify({ role: nextRole, reason: editReason.trim() || undefined }),
          });
        }
      }
      if (editStatus !== employee.status) {
        await companyAdminApiRequest(`/api/company/employees/${employee.id}/restrict`, {
          method: "POST",
          body: JSON.stringify({
            action: editStatus === "Suspended" ? "restrict" : "unrestrict",
            reason: editReason.trim() || undefined,
          }),
        });
      }
      showToast("Employee updated successfully.", "success");
      onSaved();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to update employee.", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalPortal isOpen={!!employee} onClose={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Edit Employee</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-sm text-gray-500">{employee.name}</p>
        <div className="mt-4 space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700">Role</label>
            {roleLocked ? (
              <p className="mt-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 capitalize">
                {employee.role === "admin" ? "Co-Admin" : employee.role} (only the primary admin can change this)
              </p>
            ) : (
              <>
                <select
                  value={editRoleOption}
                  onChange={(e) => setEditRoleOption(e.target.value as typeof editRoleOption)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  disabled={!actorIsPrimaryAdmin && editRoleOption === "admin"}
                >
                  {actorIsPrimaryAdmin && <option value="admin">Co-Admin</option>}
                  <option value="manager">Manager</option>
                  <option value="employee">Employee</option>
                  <option value="viewer">Viewer</option>
                  <option value="other">Other</option>
                </select>
                {editRoleOption === "other" && (
                  <input
                    type="text"
                    value={editCustomRole}
                    onChange={(e) => setEditCustomRole(e.target.value)}
                    placeholder="e.g. Sales, Support, Staff"
                    maxLength={20}
                    className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                )}
              </>
            )}
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Status</label>
            <select
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value as typeof editStatus)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              <option value="Active">Active</option>
              <option value="Suspended">Suspended</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Reason (optional)</label>
            <textarea
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-[#1f2f56] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? <InlineLoader className="text-white" /> : "Save Changes"}
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}
