"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Eye,
  Pencil,
  Radio,
  Search,
  ShieldBan,
  ShieldCheck,
  Trash2,
  UserRoundPlus,
  WifiOff,
} from "lucide-react";
import {
  PortalPageHeader,
  PortalPanel,
  PortalStatCard,
  PortalToastStack,
  PortalToolbar,
  PortalModal,
  PORTAL_ACCENTS,
} from "../components/ui";
import { csrfClient } from "@/lib/csrf-client";
import { SkeletonLoader } from "../../components/Loader";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { showConfirmDialog } from "@/app/components/ConfirmDialog";
import { toServableMediaSrc } from "@/app/lib/portfolioDisplay";

type StaffStatusFilter = "all" | "active" | "inactive" | "suspended" | "invited";
type StaffPresenceFilter = "all" | "online" | "offline" | "recent";
type ToastType = "success" | "error" | "warning";

interface CrudPermission {
  can_create?: boolean;
  can_read?: boolean;
  can_update?: boolean;
  can_delete?: boolean;
}

interface StaffMember {
  id: string;
  fullName: string;
  email: string;
  roleKey: string;
  roleLabel: string;
  departmentKey: string;
  departmentLabel: string;
  status: "Active" | "Inactive" | "Suspended" | "Invited";
  joinedAt: string | null;
  lastLoginAt: string | null;
  profileImage: string | null;
  permissions: Record<string, CrudPermission>;
}

interface StaffActivity {
  id: string;
  actorName: string;
  action: string;
  source: string;
  ipAddress: string;
  timestamp: string | null;
}

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface StaffFormState {
  fullName: string;
  email: string;
  roleKey: string;
  customRole: string;
  departmentKey: string;
  status: "active" | "inactive";
}

function resolveApiBaseUrl(): string {
  return getFrontendApiBaseUrl();
}

const ROLE_OPTIONS = [
  { value: "web_developer", label: "Web Developer", department: "web_dev" },
  { value: "sales_rep", label: "Sales", department: "sales" },
  { value: "admin", label: "Admin Support", department: "admin" },
  { value: "support_agent", label: "Marketing / Support", department: "support" },
  { value: "analyst", label: "Graphic Design / Analyst", department: "analytics" },
  { value: "custom", label: "Custom Title", department: "admin" },
] as const;

const DEPARTMENT_LABELS: Record<string, string> = {
  web_dev: "Web Development",
  sales: "Sales",
  admin: "Administration",
  support: "Support",
  analytics: "Analytics",
};

function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return (
    window.localStorage.getItem("auth_token") ||
    window.localStorage.getItem("superadmin_token") ||
    window.sessionStorage.getItem("auth_token") ||
    window.sessionStorage.getItem("superadmin_token") ||
    null
  );
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const objectPayload = payload as {
    error?: { message?: string; code?: string } | string;
    message?: string;
    code?: string;
  };
  if (typeof objectPayload.error === "string") return objectPayload.error;
  if (objectPayload.error?.message) return objectPayload.error.message;
  if (objectPayload.message) return objectPayload.message;
  return fallback;
}

function isStateChangingMethod(method?: string): boolean {
  const normalized = (method ?? "GET").toUpperCase();
  return normalized !== "GET" && normalized !== "HEAD" && normalized !== "OPTIONS";
}

function isCsrfError(status: number, payload: unknown): boolean {
  if (status !== 403) return false;
  if (!payload || typeof payload !== "object") return false;
  const objectPayload = payload as {
    code?: string;
    error?: { code?: string; message?: string } | string;
    message?: string;
  };
  const code =
    objectPayload.code ??
    (typeof objectPayload.error === "object" ? objectPayload.error?.code : undefined);
  if (code === "CSRF_TOKEN_INVALID" || code === "INVALID_CSRF_TOKEN") return true;
  const message =
    (typeof objectPayload.error === "object" ? objectPayload.error?.message : undefined) ??
    objectPayload.message ??
    (typeof objectPayload.error === "string" ? objectPayload.error : "");
  return /csrf/i.test(message);
}

function formatDateTime(value: string | null): string {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString();
}

function buildInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "NA";
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? parts[0]?.[1] ?? "";
  return `${first}${second}`.toUpperCase();
}

function normalizeLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeStatus(raw: unknown): StaffMember["status"] {
  if (typeof raw === "boolean") return raw ? "Active" : "Inactive";
  const text = String(raw ?? "").toLowerCase();
  if (text.includes("suspend")) return "Suspended";
  if (text.includes("invite")) return "Invited";
  if (text === "false" || text === "inactive") return "Inactive";
  if (text === "active" || text === "true") return "Active";
  return "Inactive";
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" ") || "Staff",
  };
}

function parseStaff(item: Record<string, unknown>): StaffMember {
  const firstName = String(item.first_name ?? "").trim();
  const lastName = String(item.last_name ?? "").trim();
  const fullNameSource =
    String(item.full_name ?? "").trim() ||
    String(item.name ?? "").trim() ||
    [firstName, lastName].filter(Boolean).join(" ").trim() ||
    "Unknown Staff";

  const roleKey = String(item.role_key ?? item.role ?? item.position ?? "staff");
  const departmentKey = String(item.department_key ?? item.department ?? "admin");
  const isActive = item.is_active;
  const statusValue = item.status ?? item.invitation_status ?? (typeof isActive === "boolean" ? isActive : "inactive");
  const permissions = (item.permissions ?? {}) as Record<string, CrudPermission>;
  const profileImageRaw =
    item.profile_image ?? item.profile_url ?? item.avatar_url ?? item.photo_url ?? null;
  const profileImage =
    typeof profileImageRaw === "string" && profileImageRaw.trim()
      ? toServableMediaSrc(profileImageRaw.trim()) || null
      : null;
  return {
    id: String(item.id ?? item.staff_id ?? item.user_id ?? ""),
    fullName: fullNameSource,
    email: String(item.email ?? "N/A"),
    roleKey,
    roleLabel: normalizeLabel(roleKey),
    departmentKey,
    departmentLabel: DEPARTMENT_LABELS[departmentKey] ?? normalizeLabel(departmentKey),
    status: normalizeStatus(statusValue),
    joinedAt: typeof item.joined_at === "string" ? item.joined_at : typeof item.created_at === "string" ? item.created_at : null,
    lastLoginAt:
      typeof item.last_login_at === "string"
        ? item.last_login_at
        : typeof item.last_login === "string"
          ? item.last_login
          : typeof item.last_activity_at === "string"
            ? item.last_activity_at
            : null,
    profileImage,
    permissions: permissions && typeof permissions === "object" ? permissions : {},
  };
}

function parseActivity(item: Record<string, unknown>): StaffActivity {
  const staffObj =
    item.staff && typeof item.staff === "object"
      ? (item.staff as Record<string, unknown>)
      : null;
  const actorName =
    String(
      staffObj?.name ??
        item.staff_name ??
        item.actor_name ??
        item.user_name ??
        ""
    ).trim() || "Unknown Staff";

  return {
    id: String(item.id ?? item.log_id ?? crypto.randomUUID()),
    actorName,
    action: String(item.action ?? item.description ?? "Unknown action"),
    source: String(item.source ?? item.module ?? "system"),
    ipAddress: String(
      item.ip_address ??
        item.ip ??
        (item.details && typeof item.details === "object"
          ? (item.details as Record<string, unknown>).ip_address
          : null) ??
        "N/A",
    ),
    timestamp:
      typeof item.created_at === "string"
        ? item.created_at
        : typeof item.timestamp === "string"
          ? item.timestamp
          : null,
  };
}

function StaffAvatar({
  name,
  imageUrl,
  size = "md",
}: {
  name: string;
  imageUrl?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const sizeClass =
    size === "lg" ? "h-14 w-14 text-base" : size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm";

  if (imageUrl && !failed) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className={`${sizeClass} shrink-0 rounded-full object-cover ring-2 ring-white`}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      className={`inline-flex ${sizeClass} shrink-0 items-center justify-center rounded-full bg-[#2d96ea] font-semibold text-white`}
    >
      {buildInitials(name)}
    </span>
  );
}

function getStatusBadgeClass(status: StaffMember["status"]): string {
  if (status === "Active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "Suspended") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "Invited") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function defaultFormState(): StaffFormState {
  return {
    fullName: "",
    email: "",
    roleKey: "web_developer",
    customRole: "",
    departmentKey: "web_dev",
    status: "active",
  };
}

export default function StaffManagementPage() {
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [totalStaff, setTotalStaff] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StaffStatusFilter>("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [presenceFilter, setPresenceFilter] = useState<StaffPresenceFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [isActivityLoading, setIsActivityLoading] = useState(true);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState({
    total_staff: 0,
    web_developers: 0,
    sales_representatives: 0,
    admin_count: 0,
    active_staff: 0,
    inactive_staff: 0,
    online_staff: 0,
    offline_staff: 0,
    recent_activity_staff: 0,
  });

  const [activityLogs, setActivityLogs] = useState<StaffActivity[]>([]);
  const [activityPage, setActivityPage] = useState(1);
  const [activityTotalPages, setActivityTotalPages] = useState(1);
  const [activitySearch, setActivitySearch] = useState("");
  const [debouncedActivitySearch, setDebouncedActivitySearch] = useState("");
  const [showFormModal, setShowFormModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StaffMember | null>(null);
  const [formMode, setFormMode] = useState<"add" | "edit">("add");
  const [viewingStaff, setViewingStaff] = useState<StaffMember | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [formState, setFormState] = useState<StaffFormState>(defaultFormState);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof StaffFormState, string>>>({});
  const summaryCards = useMemo(
    () => [
      {
        key: "all" as const,
        label: "Total Staff",
        value: analytics.total_staff || totalStaff,
        icon: ShieldCheck,
        accent: PORTAL_ACCENTS.staff,
        hint: "Show all staff accounts",
      },
      {
        key: "online" as const,
        label: "Online",
        value: analytics.online_staff,
        icon: Radio,
        accent: PORTAL_ACCENTS.revenue,
        hint: "Show staff currently online",
      },
      {
        key: "offline" as const,
        label: "Offline",
        value: analytics.offline_staff,
        icon: WifiOff,
        accent: PORTAL_ACCENTS.warning,
        hint: "Show staff currently offline",
      },
      {
        key: "recent" as const,
        label: "Recent Activity",
        value: analytics.recent_activity_staff,
        icon: Activity,
        accent: PORTAL_ACCENTS.orders,
        hint: "Show staff with recent activity",
      },
    ],
    [
      analytics.offline_staff,
      analytics.online_staff,
      analytics.recent_activity_staff,
      analytics.total_staff,
      totalStaff,
    ],
  );

  const pushToast = useCallback((type: ToastType, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, type, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 3800);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedActivitySearch(activitySearch.trim());
      setActivityPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [activitySearch]);

  const apiRequest = useCallback(
    async (path: string, init?: RequestInit): Promise<unknown> => {
      const baseUrl = resolveApiBaseUrl();
      const isAbsoluteUrl = /^https?:\/\//i.test(path);
      if (!isAbsoluteUrl && !baseUrl && !path.startsWith("/")) {
        throw new Error("Missing NEXT_PUBLIC_API_BASE_URL configuration.");
      }
      const resolvedUrl = isAbsoluteUrl
        ? path
        : `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
      const token = readStoredToken();
      const method = (init?.method ?? "GET").toUpperCase();
      const needsCsrf = isStateChangingMethod(method);

      const buildHeaders = (csrfToken: string | null): HeadersInit => {
        const headers = new Headers(init?.headers ?? undefined);
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "application/json");
        }
        if (token) {
          headers.set("Authorization", `Bearer ${token}`);
        }
        if (csrfToken) {
          headers.set("X-CSRF-Token", csrfToken);
        }
        return headers;
      };

      const executeRequest = (csrfToken: string | null) =>
        fetch(resolvedUrl, {
          ...init,
          credentials: "include",
          headers: buildHeaders(csrfToken),
        });

      let csrfToken: string | null = null;
      if (needsCsrf) {
        csrfToken = await csrfClient.getToken(false, baseUrl || undefined);
      }

      let response = await executeRequest(csrfToken);
      let isJson = response.headers.get("content-type")?.includes("application/json");
      let payload = isJson ? await response.json().catch(() => ({})) : {};

      if (!response.ok && needsCsrf && isCsrfError(response.status, payload)) {
        const refreshedToken = await csrfClient.getToken(true, baseUrl || undefined);
        if (refreshedToken && refreshedToken !== csrfToken) {
          response = await executeRequest(refreshedToken);
          isJson = response.headers.get("content-type")?.includes("application/json");
          payload = isJson ? await response.json().catch(() => ({})) : {};
        }
      }

      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, "Request failed. Please try again."));
      }
      return payload;
    },
    []
  );
  const fetchStaff = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (roleFilter !== "all") params.set("role", roleFilter);
      if (presenceFilter !== "all") params.set("presence", presenceFilter);
      const payload = (await apiRequest(`/api/superadmin/staff?${params.toString()}`)) as {
        data?: {
          staff?: Array<Record<string, unknown>>;
          items?: Array<Record<string, unknown>>;
          pagination?: { total?: number; pages?: number; page?: number };
        };
      };
      const rawList = payload.data?.staff ?? payload.data?.items ?? [];
      const parsed = rawList.map((item) => parseStaff(item));
      const pages = Number(payload.data?.pagination?.pages ?? 1);
      const total = Number(payload.data?.pagination?.total ?? parsed.length);
      setStaffList(parsed);
      setTotalPages(Math.max(1, Number.isFinite(pages) ? pages : 1));
      setTotalStaff(Number.isFinite(total) ? total : parsed.length);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load staff list.";
      setErrorMessage(message);
      pushToast("error", message);
      setStaffList([]);
    } finally {
      setIsLoading(false);
    }
  }, [apiRequest, debouncedSearch, limit, page, presenceFilter, pushToast, roleFilter, statusFilter]);

  const fetchAnalytics = useCallback(async () => {
    try {
      const payload = (await apiRequest(`/api/superadmin/staff/analytics`)) as {
        data?: Partial<typeof analytics>;
      };

      setAnalytics((prev) => ({
        ...prev,
        ...payload.data,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load analytics.";
      pushToast("warning", message);
    }
  }, [apiRequest, pushToast]);
  const fetchActivities = useCallback(async () => {
    setIsActivityLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(activityPage),
        limit: "10",
        filter: "this_month",
      });
      if (debouncedActivitySearch) params.set("search", debouncedActivitySearch);
      const payload = (await apiRequest(`/api/superadmin/staff-activities?${params.toString()}`)) as {
        data?: {
          activities?: Array<Record<string, unknown>>;
          items?: Array<Record<string, unknown>>;
          logs?: Array<Record<string, unknown>>;
          summary?: { total_activities?: number };
        };
        meta?: {
          pagination?: { totalPages?: number; pages?: number; total?: number };
        };
      };
      const list =
        payload.data?.activities ?? payload.data?.items ?? payload.data?.logs ?? [];
      setActivityLogs(list.map((entry) => parseActivity(entry)));
      const pages = Number(
        payload.meta?.pagination?.totalPages ??
          payload.meta?.pagination?.pages ??
          1
      );
      setActivityTotalPages(Math.max(1, Number.isFinite(pages) ? pages : 1));
    } catch {
      setActivityLogs([]);
    } finally {
      setIsActivityLoading(false);
    }
  }, [activityPage, apiRequest, debouncedActivitySearch]);

  useEffect(() => {
    void fetchStaff();
  }, [fetchStaff]);

  useEffect(() => {
    void fetchAnalytics();
  }, [fetchAnalytics]);

  useEffect(() => {
    void fetchActivities();
  }, [fetchActivities]);

  function validateForm(state: StaffFormState): Partial<Record<keyof StaffFormState, string>> {
    const nextErrors: Partial<Record<keyof StaffFormState, string>> = {};
    if (!state.fullName.trim()) nextErrors.fullName = "Full name is required.";
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!state.email.trim()) nextErrors.email = "Email is required.";
    else if (!emailPattern.test(state.email.trim())) nextErrors.email = "Enter a valid email address.";
    if (!state.roleKey) nextErrors.roleKey = "Role is required.";
    if (state.roleKey === "custom" && !state.customRole.trim()) {
      nextErrors.customRole = "Custom position title is required.";
    }
    if (!state.departmentKey) nextErrors.departmentKey = "Department is required.";
    return nextErrors;
  }

  function openAddModal(): void {
    setFormMode("add");
    setSelectedStaff(null);
    setFormState(defaultFormState());
    setFormErrors({});
    setShowFormModal(true);
  }

  function openEditModal(staff: StaffMember): void {
    setFormMode("edit");
    setSelectedStaff(staff);
    setFormErrors({});
    setFormState({
      fullName: staff.fullName,
      email: staff.email,
      roleKey: ROLE_OPTIONS.some((opt) => opt.value === staff.roleKey) ? staff.roleKey : "custom",
      customRole: ROLE_OPTIONS.some((opt) => opt.value === staff.roleKey) ? "" : staff.roleLabel,
      departmentKey: staff.departmentKey || "admin",
      status: staff.status === "Active" ? "active" : "inactive",
    });
    setShowFormModal(true);
  }

  async function handleSubmitForm(): Promise<void> {
    const nextErrors = validateForm(formState);
    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const { firstName, lastName } = splitName(formState.fullName);
    const payload = {
      first_name: firstName,
      last_name: lastName,
      email: formState.email.trim().toLowerCase(),
      role_key: formState.roleKey === "custom" ? "admin" : formState.roleKey,
      department_key: formState.departmentKey,
      permissions: selectedStaff?.permissions ?? {},
      custom_title: formState.roleKey === "custom" ? formState.customRole.trim() : undefined,
      is_active: formState.status === "active",
    };

    setIsMutating(true);
    try {
      if (formMode === "add") {
        const response = (await apiRequest(`/api/superadmin/staff`, {
          method: "POST",
          body: JSON.stringify(payload),
        })) as {
          data?: {
            staff_id?: number;
            user_id?: number;
            name?: string;
            email?: string;
            role?: string;
            department?: string;
            email_sent?: boolean;
            email_error?: string | null;
          };
        };

        const createdMember = parseStaff({
          staff_id: response.data?.staff_id,
          user_id: response.data?.user_id,
          full_name: response.data?.name,
          email: response.data?.email,
          role_key: response.data?.role ?? payload.role_key,
          department_key: response.data?.department ?? payload.department_key,
          is_active: false,
          invitation_status: "invited",
          created_at: new Date().toISOString(),
        });

        setPage(1);
        setStaffList((previous) => {
          const withoutDuplicate = previous.filter((member) => member.id !== createdMember.id);
          return [createdMember, ...withoutDuplicate];
        });
        setTotalStaff((previous) => previous + 1);
        if (response.data?.email_sent === false) {
          pushToast(
            "error",
            response.data?.email_error ??
              "Staff account created, but the invitation email could not be sent.",
          );
        } else {
          pushToast("success", "Staff invitation sent. They must verify email and set a password.");
        }
        void fetchAnalytics();
        void fetchActivities();
      } else if (selectedStaff) {
        let updatedThroughUnifiedEndpoint = true;
        try {
          await apiRequest(`/api/superadmin/staff/${selectedStaff.id}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
        } catch {
          updatedThroughUnifiedEndpoint = false;
        }

        if (!updatedThroughUnifiedEndpoint) {
          await apiRequest(`/api/superadmin/staff/${selectedStaff.id}/role`, {
            method: "PUT",
            body: JSON.stringify({
              role_key: payload.role_key,
              department_key: payload.department_key,
            }),
          });
          await apiRequest(`/api/superadmin/staff/${selectedStaff.id}/status`, {
            method: "PATCH",
            body: JSON.stringify({ is_active: payload.is_active }),
          });
        }
        pushToast("success", "Staff member updated successfully.");
        await Promise.all([fetchStaff(), fetchAnalytics(), fetchActivities()]);
      }

      setShowFormModal(false);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to save staff member.");
    } finally {
      setIsMutating(false);
    }
  }

  async function confirmDeleteStaff(): Promise<void> {
    if (!deleteTarget) return;

    const deletedId = deleteTarget.id;
    setIsMutating(true);
    try {
      await apiRequest(`/api/superadmin/staff/${deletedId}`, { method: "DELETE" });
      setStaffList((previous) => previous.filter((member) => member.id !== deletedId));
      setTotalStaff((previous) => Math.max(0, previous - 1));
      if (viewingStaff?.id === deletedId) setViewingStaff(null);
      if (selectedStaff?.id === deletedId) setSelectedStaff(null);
      setDeleteTarget(null);
      pushToast("success", "Staff member deleted successfully.");
      void fetchAnalytics();
      void fetchActivities();
    } catch (error) {
      pushToast(
        "error",
        error instanceof Error ? error.message : "Failed to delete staff member. Please try again."
      );
    } finally {
      setIsMutating(false);
    }
  }
  async function handleToggleSuspend(staff: StaffMember): Promise<void> {
    const shouldActivate = staff.status === "Suspended" || staff.status === "Inactive";
    if (!await showConfirmDialog({
      title: shouldActivate ? "Activate staff member?" : "Suspend staff member?",
      message: shouldActivate
        ? `${staff.fullName} will regain access to staff tools and assigned clients.`
        : `${staff.fullName} will lose access to staff tools until you activate them again.`,
      confirmLabel: shouldActivate ? "Activate" : "Suspend",
      variant: shouldActivate ? "primary" : "warning",
    })) return;
    setIsMutating(true);
    try {
      await apiRequest(`/api/superadmin/staff/${staff.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: shouldActivate }),
      });
      pushToast("success", `Staff member ${shouldActivate ? "activated" : "suspended"} successfully.`);
      await Promise.all([fetchStaff(), fetchAnalytics(), fetchActivities()]);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to update status.");
    } finally {
      setIsMutating(false);
    }
  }

  return (
    <section className="space-y-5 sm:space-y-6">
      <PortalPageHeader
        title="Staff Management"
        subtitle="Manage staff accounts, permissions, and activities in real time."
        actions={
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
          >
            <UserRoundPlus className="h-4 w-4" />
            Add New Staff
          </button>
        }
      />
      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          {errorMessage}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 sm:gap-5">
        {summaryCards.map((card) => (
          <PortalStatCard
            key={card.key}
            label={card.label}
            value={String(card.value)}
            icon={card.icon}
            accent={card.accent}
            active={presenceFilter === card.key}
            hint={card.hint}
            onClick={() => {
              setPresenceFilter((prev) => (prev === card.key ? "all" : card.key));
              setPage(1);
            }}
          />
        ))}
      </div>

      <PortalToolbar
        searchValue={searchInput}
        onSearchChange={(value) => {
          setSearchInput(value);
          setPage(1);
        }}
        searchPlaceholder="Search by name, email, role..."
        actions={
          <>
            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as StaffStatusFilter);
                setPage(1);
              }}
              className="h-11 rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 outline-none focus:border-primary"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
              <option value="invited">Invited</option>
            </select>
            <select
              value={roleFilter}
              onChange={(event) => {
                setRoleFilter(event.target.value);
                setPage(1);
              }}
              className="h-11 rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 outline-none focus:border-primary"
            >
              <option value="all">All Positions</option>
              {ROLE_OPTIONS.filter((role) => role.value !== "custom").map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
            <select
              value={limit}
              onChange={(event) => {
                setLimit(Number(event.target.value));
                setPage(1);
              }}
              className="h-11 rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 outline-none focus:border-primary"
            >
              <option value={10}>10 rows</option>
              <option value={20}>20 rows</option>
              <option value={50}>50 rows</option>
            </select>
          </>
        }
      />
      <div className="space-y-5">
      <PortalPanel padding="md">
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[#6f82a8]">
                <th className="border-b border-[#e4edf9] px-4 py-3">Staff</th>
                <th className="border-b border-[#e4edf9] px-4 py-3">Role / Dept</th>
                <th className="border-b border-[#e4edf9] px-4 py-3">Status</th>
                <th className="border-b border-[#e4edf9] px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>


            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, index) => (
                    <tr key={`skeleton-${index}`}>
                      <td className="border-b border-[#eef3fb] px-4 py-3" colSpan={4}>
                        <SkeletonLoader width="w-full" height="h-9" className="rounded-lg" />
                      </td>
                    </tr>
                  ))
                : staffList.map((staff, index) => (
                    <tr key={staff.id} className={index % 2 === 0 ? "bg-white" : "bg-[#fbfdff]"}>
                      <td className="border-b border-[#eef3fb] px-4 py-3">
                        <div className="flex items-center gap-3">
                          <StaffAvatar name={staff.fullName} imageUrl={staff.profileImage} />
                          <div>
                            <p className="font-semibold text-[#2b467c]">{staff.fullName}</p>
                            <p className="text-xs text-[#6f82a8]">{staff.email}</p>
                          </div>
                        </div>
                      </td>


                      <td className="border-b border-[#eef3fb] px-4 py-3">
                        <p className="font-semibold text-[#2b467c]">{staff.roleLabel}</p>
                        <p className="text-xs text-[#6f82a8]">{staff.departmentLabel}</p>
                      </td>
                      <td className="border-b border-[#eef3fb] px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusBadgeClass(staff.status)}`}>
                          {staff.status}
                        </span>
                      </td>
                      <td className="border-b border-[#eef3fb] px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            title="View details"
                            onClick={() => setViewingStaff(staff)}
                            className="rounded-lg border border-[#d3dff0] p-2 text-[#4f6697] hover:bg-[#f5faff]"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title="Edit staff"
                            onClick={() => openEditModal(staff)}
                            className="rounded-lg border border-[#d3dff0] p-2 text-[#4f6697] hover:bg-[#f5faff]"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title={staff.status === "Suspended" || staff.status === "Inactive" ? "Activate staff" : "Suspend staff"}
                            onClick={() => void handleToggleSuspend(staff)}
                            disabled={isMutating}
                            className="rounded-lg border border-[#d3dff0] p-2 text-[#4f6697] hover:bg-[#f5faff] disabled:opacity-60"
                          >
                            {staff.status === "Suspended" || staff.status === "Inactive" ? (
                              <ShieldCheck className="h-4 w-4" />
                            ) : (
                              <ShieldBan className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            title="Delete staff"
                            onClick={() => setDeleteTarget(staff)}
                            disabled={isMutating}
                            className="rounded-lg border border-rose-200 p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        {!isLoading && staffList.length === 0 && (
          <div className="mt-4 rounded-xl border border-dashed border-[#d4e0f2] bg-[#f9fbff] py-10 text-center text-sm font-semibold text-[#6f82a8]">
            No staff members match your current filters.
          </div>
        )}

        <div className="mt-4 flex flex-col gap-3 border-t border-[#e4edf9] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[#5f739b]">
            Showing {staffList.length} of {totalStaff} staff members.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((previous) => Math.max(1, previous - 1))}
              disabled={page <= 1 || isLoading}
              className="inline-flex items-center gap-1 rounded-xl border border-[#d3dff0] bg-white px-3 py-2 text-sm font-semibold text-[#4f6697] hover:bg-[#f5faff] disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </button>
            <p className="px-2 text-sm font-semibold text-[#4f6697]">Page {page} of {totalPages}</p>
            <button
              type="button"
              onClick={() => setPage((previous) => Math.min(totalPages, previous + 1))}
              disabled={page >= totalPages || isLoading}
              className="inline-flex items-center gap-1 rounded-xl border border-[#d3dff0] bg-white px-3 py-2 text-sm font-semibold text-[#4f6697] hover:bg-[#f5faff] disabled:opacity-50"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </PortalPanel>

      <PortalPanel title="Staff Activity Log" padding="md">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[#6f82a8]">Recent actions across staff accounts and admin tools.</p>
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8598bf]" />
            <input
              type="text"
              value={activitySearch}
              onChange={(event) => setActivitySearch(event.target.value)}
              placeholder="Search activity..."
              className="h-10 w-full rounded-xl border border-[#d3dff0] bg-[#f9fbff] pl-10 pr-3 text-sm text-[#2b467c] outline-none transition-colors focus:border-[#8fb2df]"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[#6f82a8]">
                <th className="border-b border-[#e4edf9] px-4 py-3">Staff</th>
                <th className="border-b border-[#e4edf9] px-4 py-3">Action</th>
                <th className="border-b border-[#e4edf9] px-4 py-3">Source</th>
                <th className="border-b border-[#e4edf9] px-4 py-3">IP Address</th>
                <th className="border-b border-[#e4edf9] px-4 py-3">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {isActivityLoading
                ? Array.from({ length: 4 }).map((_, index) => (
                    <tr key={`activity-skeleton-${index}`}>
                      <td colSpan={5} className="border-b border-[#eef3fb] px-4 py-3">
                        <SkeletonLoader width="w-full" height="h-8" className="rounded-lg" />
                      </td>
                    </tr>
                  ))
                : activityLogs.length === 0
                  ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-[#6f82a8]">
                        No activity found for this filter.
                      </td>
                    </tr>
                  )
                : activityLogs.map((entry, index) => (
                    <tr key={entry.id} className={index % 2 === 0 ? "bg-white" : "bg-[#fbfdff]"}>
                      <td className="border-b border-[#eef3fb] px-4 py-3 font-medium text-[#2b467c]">{entry.actorName}</td>
                      <td className="border-b border-[#eef3fb] px-4 py-3 text-[#4d618e]">{entry.action}</td>
                      <td className="border-b border-[#eef3fb] px-4 py-3 text-[#4d618e]">{entry.source}</td>
                      <td className="border-b border-[#eef3fb] px-4 py-3 text-[#4d618e]">{entry.ipAddress}</td>
                      <td className="border-b border-[#eef3fb] px-4 py-3 text-[#4d618e]">{formatDateTime(entry.timestamp)}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setActivityPage((previous) => Math.max(1, previous - 1))}
            disabled={activityPage <= 1 || isActivityLoading}
            className="rounded-xl border border-[#d3dff0] px-3 py-2 text-sm font-semibold text-[#4f6697] hover:bg-[#f5faff] disabled:opacity-50"
          >
            Previous
          </button>
          <p className="px-2 text-sm font-semibold text-[#4f6697]">
            Page {activityPage} of {activityTotalPages}
          </p>
          <button
            type="button"
            onClick={() => setActivityPage((previous) => Math.min(activityTotalPages, previous + 1))}
            disabled={activityPage >= activityTotalPages || isActivityLoading}
            className="rounded-xl border border-[#d3dff0] px-3 py-2 text-sm font-semibold text-[#4f6697] hover:bg-[#f5faff] disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </PortalPanel>
      </div>



      <PortalModal
        open={showFormModal}
        onClose={() => setShowFormModal(false)}
        title={formMode === "add" ? "Add Staff Member" : "Edit Staff Member"}
        size="lg"
        preventClose={isMutating}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowFormModal(false)}
              disabled={isMutating}
              className="rounded-xl border border-[#d3dff0] bg-white px-4 py-2 text-sm font-semibold text-[#5f739b] hover:bg-[#f5faff] disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSubmitForm()}
              disabled={isMutating}
              className="rounded-xl border border-[#4787bf] bg-[#4f93c8] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3f84b8] disabled:opacity-60"
            >
              {isMutating ? "Saving..." : formMode === "add" ? "Add Staff" : "Save Changes"}
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#6f82a8]">Full Name</label>
            <input
              type="text"
              value={formState.fullName}
              onChange={(event) => setFormState((prev) => ({ ...prev, fullName: event.target.value }))}
              className="h-11 w-full rounded-xl border border-[#d3dff0] bg-[#f9fbff] px-3 text-sm text-[#2b467c] outline-none focus:border-[#8fb2df]"
            />
            {formErrors.fullName && <p className="mt-1 text-xs text-rose-600">{formErrors.fullName}</p>}
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#6f82a8]">Email</label>
            <input
              type="email"
              value={formState.email}
              onChange={(event) => setFormState((prev) => ({ ...prev, email: event.target.value }))}
              className="h-11 w-full rounded-xl border border-[#d3dff0] bg-[#f9fbff] px-3 text-sm text-[#2b467c] outline-none focus:border-[#8fb2df]"
            />
            {formErrors.email && <p className="mt-1 text-xs text-rose-600">{formErrors.email}</p>}
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#6f82a8]">Position</label>
            <select
              value={formState.roleKey}
              onChange={(event) => {
                const nextRole = event.target.value;
                const matched = ROLE_OPTIONS.find((role) => role.value === nextRole);
                setFormState((prev) => ({
                  ...prev,
                  roleKey: nextRole,
                  departmentKey: matched ? matched.department : prev.departmentKey,
                }));
              }}
              className="h-11 w-full rounded-xl border border-[#d3dff0] bg-[#f9fbff] px-3 text-sm text-[#2b467c] outline-none focus:border-[#8fb2df]"
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#6f82a8]">Department</label>
            <select
              value={formState.departmentKey}
              onChange={(event) => setFormState((prev) => ({ ...prev, departmentKey: event.target.value }))}
              className="h-11 w-full rounded-xl border border-[#d3dff0] bg-[#f9fbff] px-3 text-sm text-[#2b467c] outline-none focus:border-[#8fb2df]"
            >
              {Object.entries(DEPARTMENT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {formState.roleKey === "custom" && (
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#6f82a8]">Custom Position Title</label>
              <input
                type="text"
                value={formState.customRole}
                onChange={(event) => setFormState((prev) => ({ ...prev, customRole: event.target.value }))}
                className="h-11 w-full rounded-xl border border-[#d3dff0] bg-[#f9fbff] px-3 text-sm text-[#2b467c] outline-none focus:border-[#8fb2df]"
                placeholder="e.g., UI Designer"
              />
              {formErrors.customRole && <p className="mt-1 text-xs text-rose-600">{formErrors.customRole}</p>}
            </div>
          )}

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#6f82a8]">Status</label>
            <select
              value={formState.status}
              onChange={(event) => setFormState((prev) => ({ ...prev, status: event.target.value as "active" | "inactive" }))}
              className="h-11 w-full rounded-xl border border-[#d3dff0] bg-[#f9fbff] px-3 text-sm text-[#2b467c] outline-none focus:border-[#8fb2df]"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
      </PortalModal>

      <PortalModal
        open={Boolean(viewingStaff)}
        onClose={() => setViewingStaff(null)}
        title="Staff Details"
        size="sm"
      >
        {viewingStaff ? (
          <div className="space-y-4 text-sm text-[#4f6188]">
            <div className="flex items-center gap-3">
              <StaffAvatar name={viewingStaff.fullName} imageUrl={viewingStaff.profileImage} size="lg" />
              <div>
                <p className="text-base font-semibold text-[#2b467c]">{viewingStaff.fullName}</p>
                <p className="text-xs text-[#6f82a8]">{viewingStaff.email}</p>
              </div>
            </div>
            <div className="space-y-2 border-t border-[#e4edf9] pt-3">
              <p><span className="font-semibold text-[#2b467c]">Role:</span> {viewingStaff.roleLabel}</p>
              <p><span className="font-semibold text-[#2b467c]">Department:</span> {viewingStaff.departmentLabel}</p>
              <p><span className="font-semibold text-[#2b467c]">Status:</span> {viewingStaff.status}</p>
              <p><span className="font-semibold text-[#2b467c]">Joined:</span> {formatDateTime(viewingStaff.joinedAt)}</p>
              <p><span className="font-semibold text-[#2b467c]">Last login:</span> {formatDateTime(viewingStaff.lastLoginAt)}</p>
            </div>
          </div>
        ) : null}
      </PortalModal>

      <PortalModal
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!isMutating) setDeleteTarget(null);
        }}
        title="Delete Staff Account"
        size="sm"
        preventClose={isMutating}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              disabled={isMutating}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void confirmDeleteStaff()}
              disabled={isMutating}
              className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
            >
              {isMutating ? "Deleting..." : "Confirm Delete"}
            </button>
          </div>
        }
      >
        <p className="text-sm text-gray-600">
          Are you sure you want to permanently delete this staff account? This action cannot be undone.
        </p>
      </PortalModal>

      <PortalToastStack
        toasts={toasts.map((toast) => ({
          id: toast.id,
          type: toast.type === "warning" ? "warning" : toast.type,
          message: toast.message,
        }))}
        onDismiss={(id) => setToasts((prev) => prev.filter((toast) => toast.id !== id))}
      />
    </section>
  );
}
