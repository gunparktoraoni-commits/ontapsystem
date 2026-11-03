export type PortalRole =
  | "user"
  | "admin"
  | "company_admin"
  | "manager"
  | "super_admin"
  | "staff"
  | "dev"
  | string;

const PORTAL_PREFIXES: Record<string, string[]> = {
  user: ["/user"],
  admin: ["/admin"],
  company_admin: ["/admin"],
  manager: ["/admin"],
  super_admin: ["/superadmin"],
  staff: ["/staff"],
  // Dev may use developer tools and inspect user/SA surfaces; not admin/staff portals.
  dev: ["/dev", "/superadmin", "/user"],
};

const PORTAL_HOMES: Record<string, string> = {
  user: "/user/dashboard",
  admin: "/admin/dashboard",
  company_admin: "/admin/dashboard",
  manager: "/admin/dashboard",
  super_admin: "/superadmin/dashboard",
  staff: "/staff/dashboard",
  dev: "/dev/dashboard",
};

const LAST_PATH_STORAGE_PREFIX = "ontap:last-portal-path:";

/** Paths that should never be restored as “last visited” (auth/setup flows). */
const NON_RESTORABLE_PATHS = [
  "/user/signup",
  "/user/onboarding",
  "/user/forgot-password",
  "/user/verify-email",
  "/user/setup-password",
  "/staff/verify",
  "/staff/verify-email",
  "/staff/setup-password",
  "/super-login",
];

function normalizeRole(role: string | null | undefined): string {
  return String(role ?? "user").trim().toLowerCase();
}

function storageKeyForRole(role: PortalRole): string {
  const normalized = normalizeRole(role);
  if (
    normalized === "admin" ||
    normalized === "company_admin" ||
    normalized === "manager"
  ) {
    return `${LAST_PATH_STORAGE_PREFIX}admin`;
  }
  if (normalized === "super_admin") return `${LAST_PATH_STORAGE_PREFIX}super_admin`;
  if (normalized === "staff") return `${LAST_PATH_STORAGE_PREFIX}staff`;
  if (normalized === "dev") return `${LAST_PATH_STORAGE_PREFIX}dev`;
  return `${LAST_PATH_STORAGE_PREFIX}user`;
}

function isRestorablePath(pathname: string): boolean {
  const path = pathname.split("?")[0] ?? pathname;
  if (!path || path === "/") return false;
  return !NON_RESTORABLE_PATHS.some(
    (blocked) => path === blocked || path.startsWith(`${blocked}/`),
  );
}

export function getAllowedPrefixes(role: PortalRole): string[] {
  const normalized = normalizeRole(role);
  if (normalized === "dev") return PORTAL_PREFIXES.dev;
  if (normalized === "super_admin") return PORTAL_PREFIXES.super_admin;
  if (normalized === "staff") return PORTAL_PREFIXES.staff;
  if (
    normalized === "admin" ||
    normalized === "company_admin" ||
    normalized === "manager"
  ) {
    return PORTAL_PREFIXES.admin;
  }
  return PORTAL_PREFIXES.user;
}

export function getPortalHomeForRole(role: PortalRole): string {
  const normalized = normalizeRole(role);
  return PORTAL_HOMES[normalized] ?? PORTAL_HOMES.user;
}

export function canAccessPath(role: PortalRole, pathname: string): boolean {
  const path = pathname.split("?")[0] ?? pathname;
  const prefixes = getAllowedPrefixes(role);
  return prefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export function isCrossPortalPath(pathname: string): boolean {
  const path = pathname.split("?")[0] ?? pathname;
  return (
    path.startsWith("/user") ||
    path.startsWith("/admin") ||
    path.startsWith("/superadmin") ||
    path.startsWith("/staff") ||
    path.startsWith("/dev")
  );
}

/**
 * Persist the last allowed page inside the role’s portal so cross-portal
 * URL typing can restore it instead of always dumping to dashboard home.
 */
export function rememberPortalPath(role: PortalRole, pathname: string): void {
  if (typeof window === "undefined") return;
  const path = pathname.split("?")[0] ?? pathname;
  if (!canAccessPath(role, path) || !isRestorablePath(path)) return;
  try {
    window.sessionStorage.setItem(storageKeyForRole(role), path);
  } catch {
    // ignore quota / private mode
  }
}

export function getLastPortalPath(role: PortalRole): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(storageKeyForRole(role));
    if (!stored) return null;
    const path = stored.split("?")[0] ?? stored;
    if (!canAccessPath(role, path) || !isRestorablePath(path)) return null;
    return path;
  } catch {
    return null;
  }
}

/**
 * Where to send a user who hit a path they cannot access.
 * Prefers last visited page in their portal, then an explicit fallback, then portal home.
 */
export function resolveRedirectForUnauthorized(
  role: PortalRole,
  attemptedPath?: string,
  fallbackPath?: string,
): string {
  if (attemptedPath && canAccessPath(role, attemptedPath)) {
    return attemptedPath.split("?")[0] ?? attemptedPath;
  }

  const lastPath = getLastPortalPath(role);
  if (lastPath && canAccessPath(role, lastPath)) {
    return lastPath;
  }

  if (fallbackPath && canAccessPath(role, fallbackPath)) {
    return fallbackPath.split("?")[0] ?? fallbackPath;
  }

  return getPortalHomeForRole(role);
}

/** Convenience alias used by layouts when bouncing cross-portal navigations. */
export function getSafePortalRedirect(
  role: PortalRole,
  fallbackPath?: string,
): string {
  return resolveRedirectForUnauthorized(role, undefined, fallbackPath);
}
