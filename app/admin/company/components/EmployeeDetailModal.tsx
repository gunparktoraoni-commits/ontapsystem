"use client";

import React, { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { ModalPortal } from "@/app/components/ModalPortal";
import { showToast } from "@/app/components/Toast";
import { toServableMediaSrc } from "@/app/lib/portfolioDisplay";
import {
  X,
  UserMinus,
  ShieldAlert,
  ShieldCheck,
  PencilLine,
  Mail,
  Calendar,
  CreditCard,
  Eye,
  Target,
  MessageSquare,
} from "lucide-react";
import {
  companyAdminApiRequest,
  initialsFromName,
  normalizeResponseData,
  readStoredUserId,
  type EmployeePreviewRow,
} from "../../lib/companyAdminApi";
import RemoveEmployeeConfirmModal, { useRemoveEmployee } from "./RemoveEmployeeConfirmModal";
import RestrictionRequestModal from "./RestrictionRequestModal";
import AssignCoAdminModal from "./AssignCoAdminModal";
import DemoteCoAdminModal from "./DemoteCoAdminModal";
import TransferOwnershipModal from "./TransferOwnershipModal";
import { InlineLoader } from "../../../components/Loader";

type EmployeeDetail = {
  employee_id: string;
  user_id: string;
  name: string;
  email: string;
  profile_image: string | null;
  role: string;
  is_primary_admin?: boolean;
  is_co_admin?: boolean;
  permissions?: Record<string, boolean> | null;
  is_active: boolean;
  joined_at: string | null;
  last_active: string | null;
  account_created_at: string | null;
  bizcard_count: number;
};

type ActivityLatest = {
  profile_views: number;
  contact_saves: number;
  inquiries_count: number;
  rank_score: number;
} | null;

type Props = {
  employee: EmployeePreviewRow | null;
  companyName: string;
  actorIsPrimaryAdmin: boolean;
  coAdminCount?: number;
  coAdminLimit?: number;
  onClose: () => void;
  onUpdated: () => void;
  /** Opens the latest professional EditEmployeeModal (preferred over legacy role-only editor). */
  onEditProfessional?: (employee: EmployeePreviewRow) => void;
};

export default function EmployeeDetailModal({
  employee,
  companyName,
  actorIsPrimaryAdmin,
  coAdminCount = 0,
  coAdminLimit = 3,
  onClose,
  onUpdated,
  onEditProfessional,
}: Props) {
  const [detail, setDetail] = useState<EmployeeDetail | null>(null);
  const [activity, setActivity] = useState<ActivityLatest>(null);
  const [loading, setLoading] = useState(false);

  const [removeOpen, setRemoveOpen] = useState(false);
  const [restrictOpen, setRestrictOpen] = useState(false);
  const [coAdminOpen, setCoAdminOpen] = useState(false);
  const [demoteOpen, setDemoteOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const removeEmployee = useRemoveEmployee();
  const currentUserId = readStoredUserId();
  const isSelf = employee?.userId === currentUserId;
  const atCoAdminLimit = coAdminCount >= coAdminLimit;
  const canAssignCoAdmin =
    actorIsPrimaryAdmin && !isSelf && employee?.role.toLowerCase() !== "admin" && !atCoAdminLimit;
  const canDemoteCoAdmin = actorIsPrimaryAdmin && Boolean(detail?.is_co_admin);
  const canTransferOwnership =
    actorIsPrimaryAdmin &&
    !isSelf &&
    employee?.status === "Active" &&
    !detail?.is_primary_admin;

  const fetchDetail = useCallback(async () => {
    if (!employee) return;
    setLoading(true);
    try {
      const payload = (await companyAdminApiRequest(
        `/api/company/employees/${employee.id}`,
      )) as {
        data?: { employee?: EmployeeDetail; activity?: { latest?: ActivityLatest } };
        employee?: EmployeeDetail;
        activity?: { latest?: ActivityLatest };
      };
      const data = normalizeResponseData(payload) as {
        employee?: EmployeeDetail;
        activity?: { latest?: ActivityLatest };
      };
      setDetail(data.employee ?? null);
      setActivity(data.activity?.latest ?? null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to load employee.", "error");
    } finally {
      setLoading(false);
    }
  }, [employee]);

  useEffect(() => {
    if (employee) void fetchDetail();
    else {
      setDetail(null);
      setActivity(null);
    }
  }, [employee, fetchDetail]);

  if (!employee) return null;

  const display = detail ?? {
    employee_id: employee.id,
    user_id: employee.userId,
    name: employee.name,
    email: employee.email,

    profile_image: employee.profileImage,
    role: employee.role,

    is_active: employee.status === "Active",

    joined_at: employee.joinedAt,

    last_active: null,

    account_created_at: null,
    bizcard_count: employee.bizcardCount,

  };

  return (

    <>
      <ModalPortal isOpen={!!employee} onClose={onClose}>
        <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-14 w-14 rounded-full bg-primary flex items-center justify-center text-white font-semibold shrink-0 overflow-hidden">
                {display.profile_image ? (
                  <img
                    src={toServableMediaSrc(display.profile_image)}
                    alt={display.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  initialsFromName(display.name)
                )}
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-gray-900 truncate">{display.name}</h3>
                <p className="text-sm text-gray-500 truncate">{display.email}</p>
                <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${display.is_active ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                  {display.is_active ? "Active" : "Suspended"}
                </span>
                {detail?.is_co_admin && (
                  <span className="mt-1 ml-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-primary/10 text-primary">
                    Co-Admin
                  </span>
                )}
                {detail?.is_primary_admin && (
                  <span className="mt-1 ml-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-violet-50 text-violet-700">
                    Primary Admin
                  </span>
                )}
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 shrink-0">
              <X className="h-4 w-4" />
            </button>
          
          
          </div>


          {loading ? (
            <div className="flex items-center justify-center py-12">
              <InlineLoader />
            </div>
          ) : (
            <>
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3">
                  <p className="text-xs text-gray-500 flex items-center gap-1"><CreditCard className="h-3.5 w-3.5" /> BizCards</p>
                  <p className="mt-1 font-bold text-gray-900">{display.bizcard_count}</p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3">
                  <p className="text-xs text-gray-500 flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Role</p>
                  <p className="mt-1 font-bold text-gray-900 capitalize">
                    {detail?.is_co_admin ? "Co-Admin" : display.role}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3">
                  <p className="text-xs text-gray-500 flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Joined</p>
                  <p className="mt-1 font-semibold text-gray-900">
                    {display.joined_at ? format(new Date(display.joined_at), "MMM d, yyyy") : "—"}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3">
                  <p className="text-xs text-gray-500 flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> Account Created</p>
                  <p className="mt-1 font-semibold text-gray-900">
                    {display.account_created_at ? format(new Date(display.account_created_at), "MMM d, yyyy") : "—"}
                  </p>
                </div>
              </div>


              {activity && (
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-gray-100 p-3 text-center">
                    <Eye className="h-4 w-4 mx-auto text-primary" />
                    <p className="mt-1 text-xs text-gray-500">Views</p>
                    <p className="font-bold text-gray-900">{activity.profile_views}</p>
                  </div>
                  <div className="rounded-xl border border-gray-100 p-3 text-center">
                    <Target className="h-4 w-4 mx-auto text-primary" />
                    <p className="mt-1 text-xs text-gray-500">Contacts</p>
                    <p className="font-bold text-gray-900">{activity.contact_saves}</p>
                  </div>
                  <div className="rounded-xl border border-gray-100 p-3 text-center">
                    <MessageSquare className="h-4 w-4 mx-auto text-primary" />
                    <p className="mt-1 text-xs text-gray-500">Inquiries</p>
                    <p className="font-bold text-gray-900">{activity.inquiries_count}</p>
                  </div>
                </div>
              )}

              {actorIsPrimaryAdmin && (
                <p className="mt-3 text-xs text-gray-500">
                  Co-admins: {coAdminCount}/{coAdminLimit}
                  {atCoAdminLimit ? " (limit reached)" : ""}
                </p>
              )}

              {!isSelf && (
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (onEditProfessional) {
                        onEditProfessional(employee);
                        return;
                      }
                    }}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    <PencilLine className="h-3.5 w-3.5" /> Edit Details
                  </button>
                  {canAssignCoAdmin && (
                    <button
                      type="button"
                      onClick={() => setCoAdminOpen(true)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs font-semibold text-primary hover:bg-primary/10"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> Assign Co-Admin
                    </button>
                  )}
                  {actorIsPrimaryAdmin && atCoAdminLimit && employee?.role.toLowerCase() !== "admin" && (
                    <p className="col-span-2 text-xs text-amber-700 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
                      Co-admin limit reached ({coAdminLimit}). Demote a co-admin before assigning another.
                    </p>
                  )}
                  {canTransferOwnership && (
                    <button
                      type="button"
                      onClick={() => setTransferOpen(true)}
                      className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5 text-xs font-semibold text-violet-800 hover:bg-violet-100"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> Transfer Primary Admin
                    </button>
                  )}
                  {canDemoteCoAdmin && (
                    <button
                      type="button"
                      onClick={() => setDemoteOpen(true)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> Demote Co-Admin
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setRestrictOpen(true)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-200 px-3 py-2.5 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                  >
                    <ShieldAlert className="h-3.5 w-3.5" /> Request Restriction
                  </button>
                  <button
                    type="button"
                    onClick={() => setRemoveOpen(true)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                  >
                    <UserMinus className="h-3.5 w-3.5" /> Remove
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </ModalPortal>

      <RemoveEmployeeConfirmModal
        isOpen={removeOpen}
        employeeName={employee.name}
        onClose={() => setRemoveOpen(false)}
        onConfirm={async (reason) => {
          await removeEmployee(employee.id, reason);
          showToast("Employee removed successfully.", "success");
          onUpdated();
          onClose();
        }}
      />

      <RestrictionRequestModal
        isOpen={restrictOpen}
        employeeId={employee.id}
        employeeName={employee.name}
        companyName={companyName}
        onClose={() => setRestrictOpen(false)}
        onSuccess={onUpdated}
      />

      <AssignCoAdminModal
        isOpen={coAdminOpen}
        employeeId={employee.id}
        employeeName={employee.name}
        coAdminCount={coAdminCount}
        coAdminLimit={coAdminLimit}
        onClose={() => setCoAdminOpen(false)}
        onSuccess={() => {
          onUpdated();
          void fetchDetail();
        }}
      />

      <TransferOwnershipModal
        isOpen={transferOpen}
        employeeId={employee.id}
        employeeName={employee.name}
        coAdminCount={coAdminCount}
        coAdminLimit={coAdminLimit}
        onClose={() => setTransferOpen(false)}
        onSuccess={() => {
          onUpdated();
          onClose();
        }}
      />

      <DemoteCoAdminModal
        isOpen={demoteOpen}
        employeeId={employee.id}
        employeeName={employee.name}
        onClose={() => setDemoteOpen(false)}
        onSuccess={() => {
          onUpdated();
          void fetchDetail();
        }}
      />
    </>
  );
}
