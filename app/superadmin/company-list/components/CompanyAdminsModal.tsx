"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Crown, Shield, ShieldOff, UserCog } from "lucide-react";
import { PortalModal } from "../../components/ui";
import { InlineLoader } from "../../../components/Loader";

export const SUPERADMIN_CO_ADMIN_PERMISSION_OPTIONS = [
  {
    key: "manage_employees" as const,
    label: "Manage employees",
    description: "Invite, edit, restrict, and remove employees (not other co-admins).",
  },
  {
    key: "view_analytics" as const,
    label: "View analytics",
    description: "Access company performance charts and rankings.",
  },
  {
    key: "edit_company" as const,
    label: "Edit company settings",
    description: "Update company profile, notifications, and security settings.",
  },
  {
    key: "manage_inquiries" as const,
    label: "Manage inquiries",
    description: "Handle company inquiry messages.",
  },
];

export type CoAdminPermissionKey = (typeof SUPERADMIN_CO_ADMIN_PERMISSION_OPTIONS)[number]["key"];

export const DEFAULT_CO_ADMIN_PERMISSIONS: Record<CoAdminPermissionKey, boolean> = {
  manage_employees: true,
  view_analytics: true,
  edit_company: false,
  manage_inquiries: true,
};

type CompanyEmployeeRow = {
  employee_id: string;
  user: {
    user_id: string;
    name: string;
    email: string;
    profile_image: string | null;
  };
  role: string;
  permissions: Record<string, boolean> | null;
  is_primary_admin: boolean;
  is_co_admin: boolean;
  is_active: boolean;
};

type CompanyAdminsModalProps = {
  open: boolean;
  companyId: string | null;
  companyName: string | null;
  onClose: () => void;
  apiBaseUrl: string;
  buildAuthHeaders: (method?: string) => Promise<Record<string, string>>;
  extractErrorMessage: (payload: unknown, fallback: string) => string;
  onChanged: () => void;
  onSuccessMessage: (message: string) => void;
  onErrorMessage: (message: string) => void;
};

type EmployeesResponse = {
  success: boolean;
  data?: {
    company: {
      company_id: string;
      company_name: string;
      primary_admin: { user_id: string; name: string; email: string } | null;
      co_admin_count: number;
      co_admin_limit: number;
    };
    employees: CompanyEmployeeRow[];
    summary: {
      co_admin_count: number;
      co_admin_limit: number;
    };
  };
  error?: { message?: string };
  message?: string;
};

export function CompanyAdminsModal({
  open,
  companyId,
  companyName,
  onClose,
  apiBaseUrl,
  buildAuthHeaders,
  extractErrorMessage,
  onChanged,
  onSuccessMessage,
  onErrorMessage,
}: CompanyAdminsModalProps) {
  const [loading, setLoading] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [employees, setEmployees] = useState<CompanyEmployeeRow[]>([]);
  const [coAdminCount, setCoAdminCount] = useState(0);
  const [coAdminLimit, setCoAdminLimit] = useState(3);
  const [primaryAdmin, setPrimaryAdmin] = useState<{
    user_id: string;
    name: string;
    email: string;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [permissionDraft, setPermissionDraft] = useState({ ...DEFAULT_CO_ADMIN_PERMISSIONS });
  const [keepOutgoingAsCoAdmin, setKeepOutgoingAsCoAdmin] = useState(true);
  const [confirmPrimaryId, setConfirmPrimaryId] = useState<string | null>(null);

  const selectedEmployee = useMemo(
    () => employees.find((row) => row.employee_id === selectedEmployeeId) ?? null,
    [employees, selectedEmployeeId],
  );

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (row) =>
        row.user.name.toLowerCase().includes(q) ||
        row.user.email.toLowerCase().includes(q) ||
        row.role.toLowerCase().includes(q),
    );
  }, [employees, search]);

  const loadEmployees = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const headers = await buildAuthHeaders("GET");
      const response = await fetch(
        `${apiBaseUrl}/api/superadmin/companies/${companyId}/employees?limit=100&status=all&sort_by=name&sort_dir=asc`,
        {
          method: "GET",
          credentials: "include",
          headers,
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as EmployeesResponse;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(extractErrorMessage(payload, "Failed to load company employees."));
      }
      setEmployees(payload.data.employees);
      setPrimaryAdmin(payload.data.company.primary_admin);
      setCoAdminCount(payload.data.company.co_admin_count);
      setCoAdminLimit(payload.data.company.co_admin_limit);
    } catch (error) {
      onErrorMessage(error instanceof Error ? error.message : "Failed to load company employees.");
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, buildAuthHeaders, companyId, extractErrorMessage, onErrorMessage]);

  useEffect(() => {
    if (!open || !companyId) return;
    setSearch("");
    setSelectedEmployeeId(null);
    setConfirmPrimaryId(null);
    setKeepOutgoingAsCoAdmin(true);
    void loadEmployees();
  }, [open, companyId, loadEmployees]);

  useEffect(() => {
    if (!selectedEmployee) {
      setPermissionDraft({ ...DEFAULT_CO_ADMIN_PERMISSIONS });
      return;
    }
    if (selectedEmployee.is_co_admin && selectedEmployee.permissions) {
      setPermissionDraft({
        ...DEFAULT_CO_ADMIN_PERMISSIONS,
        ...Object.fromEntries(
          SUPERADMIN_CO_ADMIN_PERMISSION_OPTIONS.map((option) => [
            option.key,
            Boolean(selectedEmployee.permissions?.[option.key]),
          ]),
        ),
      } as Record<CoAdminPermissionKey, boolean>);
      return;
    }
    setPermissionDraft({ ...DEFAULT_CO_ADMIN_PERMISSIONS });
  }, [selectedEmployee]);

  async function mutateRole(
    employeeId: string,
    body: { role: string; reason?: string; permissions?: Record<string, boolean> },
    successMessage: string,
  ) {
    if (!companyId) return;
    setMutatingId(employeeId);
    try {
      const headers = await buildAuthHeaders("PUT");
      const response = await fetch(
        `${apiBaseUrl}/api/superadmin/companies/${companyId}/employees/${employeeId}/role`,
        {
          method: "PUT",
          credentials: "include",
          headers,
          body: JSON.stringify(body),
        },
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(extractErrorMessage(payload, "Failed to update employee role."));
      }
      onSuccessMessage(successMessage);
      await loadEmployees();
      onChanged();
    } catch (error) {
      onErrorMessage(error instanceof Error ? error.message : "Failed to update employee role.");
    } finally {
      setMutatingId(null);
    }
  }

  async function setPrimaryAdminForEmployee(employeeId: string) {
    if (!companyId) return;
    setMutatingId(employeeId);
    try {
      const headers = await buildAuthHeaders("POST");
      const response = await fetch(
        `${apiBaseUrl}/api/superadmin/companies/${companyId}/admin/transfer`,
        {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({
            target_employee_id: employeeId,
            reason: "Superadmin assigned primary administrator",
            keep_outgoing_as_co_admin: keepOutgoingAsCoAdmin,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(extractErrorMessage(payload, "Failed to set primary administrator."));
      }
      onSuccessMessage("Primary administrator updated.");
      setConfirmPrimaryId(null);
      await loadEmployees();
      onChanged();
    } catch (error) {
      onErrorMessage(error instanceof Error ? error.message : "Failed to set primary administrator.");
    } finally {
      setMutatingId(null);
    }
  }

  return (
    <PortalModal
      open={open}
      onClose={onClose}
      title="Manage Company Admins"
      description={
        companyName
          ? `Assign the primary administrator and co-admins for ${companyName}.`
          : "Assign the primary administrator and co-admins for this company."
      }
      size="xl"
      footer={
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Primary administrator</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">
                {primaryAdmin?.name || "Unassigned"}
              </p>
              <p className="text-xs text-gray-500">{primaryAdmin?.email || "No primary admin set"}</p>
            </div>
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Co-admins: <span className="font-semibold">{coAdminCount}/{coAdminLimit}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-3">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search employees by name or email..."
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />

            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="h-14 animate-pulse rounded-xl bg-primary/10" />
                ))}
              </div>
            ) : filteredEmployees.length === 0 ? (
              <p className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
                No employees found for this company.
              </p>
            ) : (
              <ul className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                {filteredEmployees.map((employee) => {
                  const selected = selectedEmployeeId === employee.employee_id;
                  const busy = mutatingId === employee.employee_id;
                  return (
                    <li key={employee.employee_id}>
                      <button
                        type="button"
                        onClick={() => setSelectedEmployeeId(employee.employee_id)}
                        className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                          selected
                            ? "border-primary bg-primary/5"
                            : "border-gray-100 bg-white hover:bg-gray-50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-gray-900">{employee.user.name}</p>
                            <p className="truncate text-xs text-gray-500">{employee.user.email}</p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {employee.is_primary_admin ? (
                                <Badge tone="amber">Primary admin</Badge>
                              ) : employee.is_co_admin ? (
                                <Badge tone="sky">Co-admin</Badge>
                              ) : (
                                <Badge tone="slate">{employee.role}</Badge>
                              )}
                              {!employee.is_active ? <Badge tone="rose">Restricted</Badge> : null}
                            </div>
                          </div>
                          {busy ? <InlineLoader className="text-primary" /> : <UserCog className="h-4 w-4 text-gray-400" />}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-gray-100 p-4">
            {!selectedEmployee ? (
              <div className="flex h-full min-h-[16rem] items-center justify-center text-center text-sm text-gray-500">
                Select an employee to assign, modify, or remove admin access.
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{selectedEmployee.user.name}</p>
                  <p className="text-xs text-gray-500">{selectedEmployee.user.email}</p>
                </div>

                {selectedEmployee.is_primary_admin ? (
                  <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    This employee is the primary administrator and has full company authority.
                    Transfer primary ownership to another employee to change this.
                  </p>
                ) : (
                  <>
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-gray-800">Co-admin permissions</p>
                      {SUPERADMIN_CO_ADMIN_PERMISSION_OPTIONS.map((option) => (
                        <label
                          key={option.key}
                          className="flex items-start gap-2 rounded-xl border border-gray-100 px-3 py-2.5 text-sm text-gray-700"
                        >
                          <input
                            type="checkbox"
                            checked={permissionDraft[option.key]}
                            onChange={(event) =>
                              setPermissionDraft((prev) => ({
                                ...prev,
                                [option.key]: event.target.checked,
                              }))
                            }
                            className="mt-0.5 h-4 w-4 rounded border-gray-300"
                          />
                          <span>
                            <span className="block font-medium">{option.label}</span>
                            <span className="text-xs text-gray-500">{option.description}</span>
                          </span>
                        </label>
                      ))}
                    </div>

                    <div className="flex flex-col gap-2">
                      {selectedEmployee.is_co_admin ? (
                        <>
                          <ActionButton
                            disabled={!selectedEmployee.is_active || mutatingId === selectedEmployee.employee_id}
                            onClick={() =>
                              void mutateRole(
                                selectedEmployee.employee_id,
                                {
                                  role: "admin",
                                  reason: "Superadmin updated co-admin permissions",
                                  permissions: permissionDraft,
                                },
                                "Co-admin permissions updated.",
                              )
                            }
                            icon={<Shield className="h-4 w-4" />}
                            label="Save co-admin permissions"
                          />
                          <ActionButton
                            tone="rose"
                            disabled={!selectedEmployee.is_active || mutatingId === selectedEmployee.employee_id}
                            onClick={() =>
                              void mutateRole(
                                selectedEmployee.employee_id,
                                {
                                  role: "employee",
                                  reason: "Superadmin removed co-admin",
                                },
                                "Co-admin removed.",
                              )
                            }
                            icon={<ShieldOff className="h-4 w-4" />}
                            label="Remove co-admin"
                          />
                        </>
                      ) : (
                        <ActionButton
                          disabled={
                            !selectedEmployee.is_active ||
                            coAdminCount >= coAdminLimit ||
                            mutatingId === selectedEmployee.employee_id
                          }
                          onClick={() =>
                            void mutateRole(
                              selectedEmployee.employee_id,
                              {
                                role: "admin",
                                reason: "Superadmin assigned co-admin",
                                permissions: permissionDraft,
                              },
                              "Employee assigned as co-admin.",
                            )
                          }
                          icon={<Shield className="h-4 w-4" />}
                          label={
                            coAdminCount >= coAdminLimit
                              ? "Co-admin limit reached"
                              : "Assign as co-admin"
                          }
                        />
                      )}

                      {confirmPrimaryId === selectedEmployee.employee_id ? (
                        <div className="space-y-2 rounded-xl border border-amber-100 bg-amber-50 p-3">
                          <p className="text-sm text-amber-900">
                            Set <span className="font-semibold">{selectedEmployee.user.name}</span> as the
                            primary administrator?
                          </p>
                          <label className="flex items-start gap-2 text-xs text-amber-900">
                            <input
                              type="checkbox"
                              checked={keepOutgoingAsCoAdmin}
                              onChange={(event) => setKeepOutgoingAsCoAdmin(event.target.checked)}
                              className="mt-0.5 h-4 w-4 rounded border-amber-300"
                            />
                            Keep the current primary admin as a co-admin (if the limit allows)
                          </label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setConfirmPrimaryId(null)}
                              className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={mutatingId === selectedEmployee.employee_id}
                              onClick={() => void setPrimaryAdminForEmployee(selectedEmployee.employee_id)}
                              className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                            >
                              Confirm primary admin
                            </button>
                          </div>
                        </div>
                      ) : (
                        <ActionButton
                          tone="amber"
                          disabled={!selectedEmployee.is_active || mutatingId === selectedEmployee.employee_id}
                          onClick={() => setConfirmPrimaryId(selectedEmployee.employee_id)}
                          icon={<Crown className="h-4 w-4" />}
                          label="Set as primary admin"
                        />
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </PortalModal>
  );
}

function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "amber" | "sky" | "slate" | "rose";
}) {
  const classes =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : tone === "sky"
        ? "border-sky-200 bg-sky-50 text-sky-800"
        : tone === "rose"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${classes}`}>
      {children}
    </span>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  icon,
  tone = "primary",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon: ReactNode;
  tone?: "primary" | "rose" | "amber";
}) {
  const classes =
    tone === "rose"
      ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
        : "border-primary/20 bg-primary/10 text-primary hover:bg-primary/15";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${classes}`}
    >
      {icon}
      {label}
    </button>
  );
}
