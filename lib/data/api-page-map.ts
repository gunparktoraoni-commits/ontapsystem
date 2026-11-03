/**
 * Maps portal pages to the API paths they fetch.
 * Used by the Dev Portal API Explorer for reverse navigation (API ↔ page).
 */

export type PortalSurface =
  | "dev"
  | "superadmin"
  | "admin"
  | "staff"
  | "user"
  | "public";

export type PageApiUsage = {
  /** App route path, e.g. /dev/auth-health */
  path: string;
  /** Human label for navigation */
  label: string;
  portal: PortalSurface;
  /** API path patterns this page calls (may include trailing /* for dynamics) */
  apis: string[];
  /** Optional short note */
  note?: string;
};

/** Title-case a route segment: auth-health → Auth Health */
function labelFromPath(routePath: string): string {
  const cleaned = routePath.replace(/\s*\(layout\)\s*$/, "").replace(/\/$/, "");
  const seg = cleaned.split("/").filter(Boolean).pop() ?? cleaned;
  if (seg.startsWith("[") && seg.endsWith("]")) return "Dynamic detail";
  return seg
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function portalFromPath(routePath: string): PortalSurface {
  if (routePath.startsWith("/dev")) return "dev";
  if (routePath.startsWith("/superadmin")) return "superadmin";
  if (routePath.startsWith("/admin")) return "admin";
  if (routePath.startsWith("/staff")) return "staff";
  if (routePath.startsWith("/user")) return "user";
  return "public";
}

/** Curated overrides for better labels / notes */
const LABEL_OVERRIDES: Record<string, { label?: string; note?: string }> = {
  "/dev (layout)": { label: "Dev layout", note: "Shared session bootstrap" },
  "/dev/overview": { label: "Overview" },
  "/dev/incidents": { label: "Incidents" },
  "/dev/escalations": { label: "Escalations", note: "Re-exports Concerns" },
  "/dev/concerns": { label: "Concerns / Escalations" },
  "/dev/impact": { label: "Impact" },
  "/dev/auth-health": { label: "Auth Health" },
  "/dev/jobs": { label: "Jobs & Integrations" },
  "/dev/audit": { label: "Audit Timeline" },
  "/dev/controls": { label: "Controls" },
  "/dev/notice-board": { label: "Notice Board" },
  "/dev/system-health": { label: "System Health" },
  "/dev/api-explorer": { label: "API Explorer" },
  "/dev/clients": { label: "Clients" },
  "/dev/settings": { label: "Settings" },
  "/dev/dashboard": { label: "Dashboard (legacy)" },
  "/dev/error-logs": { label: "Error Logs" },
  "/admin (layout)": { label: "Admin layout" },
  "/staff (layout)": { label: "Staff layout" },
  "/superadmin (layout)": { label: "SuperAdmin layout" },
  "/user (layout)": { label: "User layout" },
  "/superadmin/manage-content": { label: "Manage Content" },
  "/superadmin/client-list": { label: "Users" },
  "/superadmin/support-escalations": { label: "Support Escalations" },
  "/user/bizcard": { label: "BizCard editor" },
  "/user/signup": { label: "Signup / claim flow" },
};

/**
 * Scanned + curated page → API usage.
 * Keep in sync when adding major portal fetches; scanner: scripts/scan-page-apis.mjs
 */
const RAW: Record<string, string[]> = {
  "/dev (layout)": ["/api/auth/session"],
  "/dev/overview": ["/api/dev/overview"],
  "/dev/incidents": ["/api/dev/incidents", "/api/dev/incidents/*"],
  "/dev/concerns": ["/api/superadmin/support/escalations"],
  "/dev/escalations": ["/api/superadmin/support/escalations"],
  "/dev/impact": ["/api/dev/impact/summary"],
  "/dev/auth-health": [
    "/api/dev/auth/summary",
    "/api/dev/auth/actions",
    "/api/dev/integrity/checks",
    "/api/dev/integrity/checks/*",
  ],
  "/dev/jobs": ["/api/dev/jobs/summary"],
  "/dev/audit": ["/api/dev/audit/timeline"],
  "/dev/controls": ["/api/dev/controls", "/api/dev/controls/*"],
  "/dev/notice-board": [
    "/api/dev/notices",
    "/api/dev/notices/*",
    "/api/dev/notices/users",
    "/api/media/upload",
  ],
  "/dev/system-health": ["/api/dev/system-health"],
  "/dev/api-explorer": ["/api/dev/api-explorer"],
  "/dev/clients": ["/api/superadmin/clients", "/api/superadmin/clients/summary"],
  "/dev/settings": [
    "/api/superadmin/settings/profile",
    "/api/superadmin/settings/notifications",
    "/api/superadmin/settings/security",
    "/api/superadmin/settings/change-password",
  ],
  "/dev/dashboard": [
    "/api/dashboard",
    "/api/dashboard/vcard-completion",
    "/api/dev/error-logs",
    "/api/superadmin/clients/summary",
    "/api/superadmin/settings/profile",
    "/api/superadmin/support/escalations",
  ],
  "/dev/error-logs": ["/api/dev/error-logs"],

  "/superadmin (layout)": [
    "/api/auth/session",
    "/api/superadmin/companies/impersonation/end",
  ],
  "/superadmin/client-list": [
    "/api/superadmin/clients",
    "/api/superadmin/clients/*",
    "/api/superadmin/clients/summary",
    "/api/superadmin/assign-client",
    "/api/superadmin/bizcards/*",
    "/api/superadmin/companies/pending-requests",
    "/api/superadmin/staff/for-assignment",
  ],
  "/superadmin/company-list": [
    "/api/superadmin/companies",
    "/api/superadmin/companies/*",
    "/api/superadmin/companies/export",
    "/api/superadmin/companies/impersonation/start",
    "/api/company/approve",
    "/api/company/create",
  ],
  "/superadmin/company-creation-requests": [
    "/api/company/pending-requests",
    "/api/company/approve",
  ],
  "/superadmin/affiliate": [
    "/api/superadmin/affiliates",
    "/api/superadmin/affiliates/summary",
    "/api/superadmin/affiliates/commissions",
    "/api/superadmin/affiliates/commissions/*",
    "/api/superadmin/affiliates/export",
    "/api/superadmin/affiliates/*",
  ],
  "/superadmin/manage-content": [
    "/api/superadmin/products",
    "/api/superadmin/products/*",
    "/api/superadmin/products/upload-images",
    "/api/superadmin/promos",
    "/api/superadmin/promos/*",
    "/api/superadmin/promos/target-groups",
    "/api/superadmin/subscription-plans",
    "/api/superadmin/subscription-plans/*",
    "/api/superadmin/newsletter/campaigns",
    "/api/superadmin/newsletter/campaigns/*",
    "/api/superadmin/newsletter/subscribers",
    "/api/media/upload",
  ],
  "/superadmin/promos": ["/api/superadmin/promos", "/api/superadmin/promos/*"],
  "/superadmin/staff": [
    "/api/superadmin/staff",
    "/api/superadmin/staff/*",
    "/api/superadmin/staff-activities",
    "/api/superadmin/staff/analytics",
  ],
  "/superadmin/support-escalations": ["/api/superadmin/support/escalations"],
  "/superadmin/settings": [
    "/api/superadmin/settings/profile",
    "/api/superadmin/settings/notifications",
    "/api/superadmin/settings/security",
    "/api/superadmin/settings/change-password",
    "/api/superadmin/settings/login-history",
    "/api/superadmin/settings/2fa/setup",
    "/api/superadmin/settings/2fa/enable",
    "/api/superadmin/settings/2fa/disable",
    "/api/superadmin/settings/sessions/*",
    "/api/superadmin/settings/sessions/revoke-all",
    "/api/superadmin/system/broadcast-notification",
  ],

  "/admin (layout)": [
    "/api/auth/session",
    "/api/company/my-company",
    "/api/notifications",
    "/api/notifications/*",
    "/api/notifications/unread/count",
    "/api/notifications/mark-all-read",
    "/api/support/unread/count",
    "/api/vcard/profile",
  ],
  "/admin/company": [
    "/api/company/my-company",
    "/api/company/dashboard/summary",
    "/api/company/dashboard/time-series",
    "/api/company/dashboard/employee-rankings",
    "/api/company/employees",
    "/api/company/employees/*",
    "/api/company/invitations/*",
    "/api/company/invitations/resend",
    "/api/company/join-requests",
    "/api/company/join-requests/approve",
    "/api/company/settings",
    "/api/company/theme",
    "/api/company/audit-logs",
    "/api/company/admin/transfer",
    "/api/company/name-change/request",
    "/api/company/security/randomize-code",
    "/api/company/notifications/preferences/admin",
  ],
  "/admin/employee-list": [
    "/api/company/employees",
    "/api/company/employees/*",
    "/api/company/employees/activity/summary",
    "/api/company/employees/invite",
    "/api/company/invitations/*",
    "/api/company/invitations/resend",
  ],

  "/staff (layout)": ["/api/auth/session"],
  "/staff/verify": ["/api/staff/verify"],

  "/user (layout)": [
    "/api/auth/session",
    "/api/user/profile",
    "/api/company/my-company",
    "/api/notifications",
    "/api/notifications/*",
    "/api/notifications/unread/count",
    "/api/notifications/mark-all-read",
    "/api/support/unread/count",
  ],
  "/user/bizcard": [
    "/api/auth/session",
    "/api/vcard/profile",
    "/api/vcard/services",
    "/api/vcard/setup",
    "/api/bizcard/*",
    "/api/media/upload",
    "/api/user/subscription",
  ],
  "/user/bizcard/[bizcardId]": ["/api/user/bizcards/*", "/api/inquiries"],
  "/user/bizcard/create-new": [
    "/api/user/bizcards",
    "/api/user/subscription",
    "/api/bizcard/merge",
    "/api/bizcard/update",
  ],
  "/user/signup": [
    "/api/bizcard/claim",
    "/api/bizcard/merge",
    "/api/vcard/profile",
    "/api/vcard/setup",
    "/api/media/upload",
    "/api/track/user-location",
  ],

  "/scan/[serialId]/merge": ["/api/bizcard/merge"],
  "/payment/success": [
    "/api/marketplace/checkout/session/*",
    "/api/marketplace/orders/*",
  ],
  "/feedback/[uuid]": ["/api/feedback/*"],
  "/company/accept-invite": [
    "/api/company/invitations/verify",
    "/api/company/invitations/accept",
  ],
};

export const PAGE_API_USAGE: PageApiUsage[] = Object.entries(RAW)
  .map(([path, apis]) => {
    const override = LABEL_OVERRIDES[path] ?? {};
    return {
      path,
      label: override.label ?? labelFromPath(path),
      portal: portalFromPath(path),
      apis: [...apis].sort(),
      note: override.note,
    } satisfies PageApiUsage;
  })
  .sort((a, b) => {
    const portalOrder: PortalSurface[] = [
      "dev",
      "superadmin",
      "admin",
      "staff",
      "user",
      "public",
    ];
    const po = portalOrder.indexOf(a.portal) - portalOrder.indexOf(b.portal);
    if (po !== 0) return po;
    return a.path.localeCompare(b.path);
  });

export function normalizeApiPathPattern(p: string): string {
  return p
    .split("?")[0]
    .replace(/:\w+/g, "*")
    .replace(/\[.*?\]/g, "*")
    .replace(/\/+$/, "")
    .replace(/\/\*$/, "/*");
}

/** Whether a registry path and a page-used path refer to the same family of endpoints */
export function apiPathsRelated(registryPath: string, usedPath: string): boolean {
  const a = normalizeApiPathPattern(registryPath);
  const b = normalizeApiPathPattern(usedPath);
  if (a === b) return true;

  const aBase = a.endsWith("/*") ? a.slice(0, -2) : a;
  const bBase = b.endsWith("/*") ? b.slice(0, -2) : b;

  if (a.endsWith("/*") && (b === aBase || b.startsWith(aBase + "/"))) return true;
  if (b.endsWith("/*") && (a === bBase || a.startsWith(bBase + "/"))) return true;

  // Parent/child: /api/dev/auth ↔ /api/dev/auth/summary
  if (b.startsWith(aBase + "/") || a.startsWith(bBase + "/")) return true;

  return false;
}

export type PageRef = {
  path: string;
  label: string;
  portal: PortalSurface;
};

/** Pages that call APIs related to the given registry path */
export function findPagesForApi(registryPath: string): PageRef[] {
  const seen = new Set<string>();
  const out: PageRef[] = [];
  for (const page of PAGE_API_USAGE) {
    if (page.apis.some((a) => apiPathsRelated(registryPath, a))) {
      if (seen.has(page.path)) continue;
      seen.add(page.path);
      out.push({ path: page.path, label: page.label, portal: page.portal });
    }
  }
  return out;
}

export function enrichApisWithPages<T extends { path: string }>(
  apis: T[],
): Array<T & { usedByPages: PageRef[] }> {
  return apis.map((api) => ({
    ...api,
    usedByPages: findPagesForApi(api.path),
  }));
}

export const PORTAL_LABELS: Record<PortalSurface, string> = {
  dev: "Dev Portal",
  superadmin: "Super Admin",
  admin: "Company Admin",
  staff: "Staff",
  user: "User",
  public: "Public / Misc",
};
