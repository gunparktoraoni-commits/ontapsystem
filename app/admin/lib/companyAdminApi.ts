import { getFrontendApiBaseUrl } from "../../components/apiBase";
import { csrfClient } from "@/lib/csrf-client";
import {
  buildImpersonationHeaders,
} from "@/app/lib/superadminImpersonationHandoff";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function getApiBaseUrl(): string {
  return getFrontendApiBaseUrl();
}

export function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return (
    window.localStorage.getItem("auth_token") ||
    window.sessionStorage.getItem("auth_token") ||
    window.localStorage.getItem("superadmin_token") ||
    window.sessionStorage.getItem("superadmin_token") ||
    null
  );
}

export function buildAuthHeaders(): HeadersInit {
  const token = readStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function ensureCsrfToken(forceRefresh = false): Promise<string | null> {
  const base = getApiBaseUrl();
  return csrfClient.getToken(forceRefresh, base || undefined);
}

export async function buildCompanyAdminHeaders(
  method = "GET",
  extra?: HeadersInit,
  forceCsrfRefresh = false,
  options?: { omitContentType?: boolean },
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};

  if (!options?.omitContentType) {
    headers["Content-Type"] = "application/json";
  }

  const auth = buildAuthHeaders() as Record<string, string>;
  Object.assign(headers, auth);

  if (extra) {
    if (extra instanceof Headers) {
      extra.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(extra)) {
      for (const [key, value] of extra) {
        headers[key] = value;
      }
    } else {
      Object.assign(headers, extra);
    }
  }

  const impersonationHeaders = buildImpersonationHeaders() as Record<string, string>;
  Object.assign(headers, impersonationHeaders);

  if (STATE_CHANGING_METHODS.has(method.toUpperCase())) {
    const csrf = await ensureCsrfToken(forceCsrfRefresh);
    if (!csrf) {
      throw new Error("Unable to obtain security token. Please refresh the page and try again.");
    }
    headers["X-CSRF-Token"] = csrf;
    headers["x-csrf-token"] = csrf;
  }

  return headers;
}

export const INVITE_RESEND_COOLDOWN_MS = 60_000;

export function getInviteResendCooldownKey(employeeId: string): string {
  return `company_invite_resend_${employeeId}`;
}

export function getInviteResendCooldownUntil(employeeId: string): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(getInviteResendCooldownKey(employeeId));
  const until = Number(raw ?? 0);
  return Number.isFinite(until) ? until : 0;
}

export function getInviteResendCooldownRemaining(employeeId: string, now = Date.now()): number {
  return Math.max(0, getInviteResendCooldownUntil(employeeId) - now);
}

export function setInviteResendCooldown(employeeId: string, durationMs = INVITE_RESEND_COOLDOWN_MS): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    getInviteResendCooldownKey(employeeId),
    String(Date.now() + durationMs),
  );
}

export function syncInviteResendCooldownFromError(
  employeeId: string,
  error: unknown,
  durationMs = INVITE_RESEND_COOLDOWN_MS,
): void {
  if (!(error instanceof Error)) return;
  const match = error.message.match(/wait (\d+) seconds/i);
  if (match?.[1]) {
    const seconds = Number.parseInt(match[1], 10);
    if (Number.isFinite(seconds) && seconds > 0) {
      window.localStorage.setItem(
        getInviteResendCooldownKey(employeeId),
        String(Date.now() + seconds * 1000),
      );
      return;
    }
  }
  setInviteResendCooldown(employeeId, durationMs);
}

export function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const obj = payload as {
    error?: { message?: string } | string;
    message?: string;
    code?: string;
  };
  if (obj.code === "CSRF_TOKEN_INVALID") {
    return "Security token expired. Please refresh the page and try again.";
  }
  if (typeof obj.error === "string") return obj.error;
  if (obj.error?.message) return obj.error.message;
  return obj.message ?? fallback;
}

export function normalizeResponseData<T extends object>(payload: { data?: T } & T): T {
  return (payload.data ?? payload) as T;
}

export async function companyAdminApiRequest(
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const apiBase = getApiBaseUrl();
  const url = path.startsWith("http")
    ? path
    : `${apiBase}${path.startsWith("/") ? "" : "/"}${path}`;
  const method = (init?.method ?? "GET").toUpperCase();
  const isMutating = STATE_CHANGING_METHODS.has(method);

  const execute = async (forceCsrfRefresh: boolean) => {
    const headers = await buildCompanyAdminHeaders(method, init?.headers, forceCsrfRefresh);
    return fetch(url, {
      credentials: "include",
      ...init,
      method,
      headers,
    });
  };

  let response = await execute(isMutating);
  let payload = await response.json().catch(() => ({}));

  if (
    isMutating &&
    response.status === 403 &&
    typeof payload === "object" &&
    payload !== null &&
    (payload as { code?: string }).code === "CSRF_TOKEN_INVALID"
  ) {
    response = await execute(true);
    payload = await response.json().catch(() => ({}));
  }

  if (!response.ok) {
    throw new Error(extractErrorMessage(payload, "Request failed."));
  }
  return payload;
}

/**
 * Multipart upload helper for company-admin endpoints.
 * Omits Content-Type so the browser sets the multipart boundary.
 */
export async function companyAdminFormDataRequest(
  path: string,
  formData: FormData,
  init?: Omit<RequestInit, "body">,
): Promise<unknown> {
  const apiBase = getApiBaseUrl();
  const url = path.startsWith("http")
    ? path
    : `${apiBase}${path.startsWith("/") ? "" : "/"}${path}`;
  const method = (init?.method ?? "POST").toUpperCase();
  const isMutating = STATE_CHANGING_METHODS.has(method);

  const execute = async (forceCsrfRefresh: boolean) => {
    const headers = await buildCompanyAdminHeaders(method, init?.headers, forceCsrfRefresh, {
      omitContentType: true,
    });
    // Ensure no Content-Type sneaks in from callers.
    delete headers["Content-Type"];
    delete headers["content-type"];
    return fetch(url, {
      credentials: "include",
      ...init,
      method,
      headers,
      body: formData,
    });
  };

  let response = await execute(isMutating);
  let payload = await response.json().catch(() => ({}));

  if (
    isMutating &&
    response.status === 403 &&
    typeof payload === "object" &&
    payload !== null &&
    (payload as { code?: string }).code === "CSRF_TOKEN_INVALID"
  ) {
    response = await execute(true);
    payload = await response.json().catch(() => ({}));
  }

  if (!response.ok && response.status !== 207) {
    throw new Error(extractErrorMessage(payload, "Upload failed."));
  }
  return payload;
}

export function readStoredUserId(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem("authUser");
    if (!raw) return "";
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return String(parsed.user_id ?? parsed.userId ?? parsed.id ?? "").trim();
  } catch {
    return "";
  }
}

export function initialsFromName(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "--";
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? parts[1]?.[0] ?? "" : parts[0]?.[1] ?? "";
  return `${first}${second}`.toUpperCase();
}

export type CompanyProfile = {
  company_id: string;
  company_name: string;
  company_slug: string | null;
  description: string | null;
  email: string | null;
  industry: string | null;
  phone: string | null;
  address: string | null;
  pending_name_change: string | null;
  logo_url: string | null;
  security_code: string | null;
  approval_required: boolean;
  is_public: boolean;
  company_theme: string | null;
  subscription_tier: string | null;
  max_employees: number | null;
  current_employees: number | null;
  status: string;
  my_role: string;
  my_permissions: string[];
  is_primary_admin?: boolean;
  is_co_admin?: boolean;
  co_admin_count?: number;
  co_admin_limit?: number;
};

export type CompanyNotificationPolicy = {
  join_request_enabled: boolean;
  company_details_changed_enabled: boolean;
  co_admin_changes_enabled: boolean;
  employee_management_enabled: boolean;
  daily_summary_enabled: boolean;
  weekly_summary_enabled: boolean;
  top_performer_alert_enabled: boolean;
  top_performer_alert_time: string;
  employee_daily_statistics_enabled: boolean;
  employee_weekly_statistics_enabled: boolean;
  employee_top_performer_enabled: boolean;
  timezone: string;
};

export const ADMIN_NOTIFICATION_OPTIONS: Array<{ key: keyof CompanyNotificationPolicy; label: string; description: string }> = [
  { key: "join_request_enabled", label: "New join requests", description: "Alert when someone requests to join the company." },
  { key: "company_details_changed_enabled", label: "Company details changes", description: "Alert when company profile or governance settings are updated." },
  { key: "co_admin_changes_enabled", label: "Co-admin assignments", description: "Alert when co-admins are assigned, demoted, or ownership is transferred." },
  { key: "employee_management_enabled", label: "Employee management", description: "Alert for invites, restrictions, removals, and role changes." },
  { key: "daily_summary_enabled", label: "Daily summary", description: "Daily email digest of company performance metrics." },
  { key: "weekly_summary_enabled", label: "Weekly summary", description: "Weekly email digest of company performance metrics." },
  { key: "top_performer_alert_enabled", label: "Top performer alerts", description: "Daily alert highlighting the top-performing team member." },
];

export const EMPLOYEE_NOTIFICATION_OPTIONS: Array<{ key: keyof CompanyNotificationPolicy; label: string; description: string }> = [
  { key: "employee_daily_statistics_enabled", label: "Daily statistics", description: "Notify employees about their daily performance statistics." },
  { key: "employee_weekly_statistics_enabled", label: "Weekly statistics", description: "Notify employees about their weekly performance statistics." },
  { key: "employee_top_performer_enabled", label: "Top performer recognition", description: "Notify the top-performing employee when they lead the company." },
];

export const CO_ADMIN_PERMISSION_OPTIONS = [
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

export type CoAdminPermissionKey = (typeof CO_ADMIN_PERMISSION_OPTIONS)[number]["key"];

export const DEFAULT_CO_ADMIN_PERMISSIONS: Record<CoAdminPermissionKey, boolean> = {
  manage_employees: true,
  view_analytics: true,
  edit_company: false,
  manage_inquiries: true,
};

export type TimeFilter =
  | "today"
  | "this_week"
  | "this_month"
  | "last_month"
  | "custom";

export const TIME_FILTER_OPTIONS: { value: TimeFilter; label: string; apiFilter: string }[] = [
  { value: "today", label: "Today", apiFilter: "today" },
  { value: "this_week", label: "This Week", apiFilter: "this_week" },
  { value: "this_month", label: "This Month", apiFilter: "this_month" },
  { value: "last_month", label: "Last Month", apiFilter: "last_month" },
  { value: "custom", label: "Custom Range", apiFilter: "custom" },
];

export function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function resolveCustomDateRange(start: string, end: string): { start_date: string; end_date: string } {
  return { start_date: start, end_date: end };
}

export type EmployeePreviewRow = {
  id: string;
  userId: string;
  invitationId: string | null;
  name: string;
  email: string;
  profileImage: string | null;
  role: string;
  status: "Active" | "Suspended" | "Pending Invite" | "Invite Expired";
  membershipStatus: "active" | "pending_invite";
  joinedAt: string | null;
  bizcardCount: number;
  activity: {
    views: number;
    leads: number;
    inquiries: number;
    rank: number;
  };
};

export function mapEmployeeRow(row: Record<string, unknown>): EmployeePreviewRow {
  const summary = (row.summary ?? row.activity_summary ?? {}) as Record<string, unknown>;
  const role = String(row.role ?? "employee");
  const membershipStatus =
    row.membership_status === "pending_invite" ? "pending_invite" : "active";
  const invitationExpired = row.invitation_expired === true;

  let status: EmployeePreviewRow["status"] = "Active";
  if (membershipStatus === "pending_invite") {
    status = invitationExpired ? "Invite Expired" : "Pending Invite";
  } else if (row.is_active === false) {
    status = "Suspended";
  }

  const invitationId =
    typeof row.invitation_id === "string"
      ? row.invitation_id
      : String(row.employee_id ?? "").startsWith("invite_")
        ? String(row.employee_id).replace(/^invite_/, "")
        : null;

  const rawProfile = String(row.profile_image ?? "").trim();

  return {
    id: String(row.employee_id ?? row.id ?? ""),
    userId: String(row.user_id ?? ""),
    invitationId,
    name: String(row.name ?? "Unknown"),
    email: String(row.email ?? ""),
    profileImage: rawProfile || null,
    role,
    status,
    membershipStatus,
    joinedAt: row.joined_at ? String(row.joined_at) : null,
    bizcardCount: Number(row.bizcard_count ?? 0),
    activity: {
      views: Number(summary.profile_views ?? 0),
      leads: Number(summary.contact_saves ?? 0),
      inquiries: Number(summary.inquiries_count ?? 0),
      rank: Number(summary.rank_score ?? 0),
    },
  };
}
