/**
 * Roles that permanently receive full premium bizcard access
 * without depending on paid subscription expiry.
 */
export const PRIVILEGED_PREMIUM_ROLES = ["dev", "super_admin"] as const;

export type PrivilegedPremiumRole = (typeof PRIVILEGED_PREMIUM_ROLES)[number];

/** Far-future expiry used for permanent premium on privileged accounts. */
export const PERMANENT_PREMIUM_EXPIRES_AT = new Date("9999-12-31T23:59:59.000Z");

export function normalizeRole(role: string | null | undefined): string {
  return String(role ?? "")
    .trim()
    .toLowerCase();
}

export function isPrivilegedPremiumRole(role: string | null | undefined): boolean {
  const normalized = normalizeRole(role);
  return (PRIVILEGED_PREMIUM_ROLES as readonly string[]).includes(normalized);
}

export function isSuperAdminRole(role: string | null | undefined): boolean {
  return normalizeRole(role) === "super_admin";
}

export function isDevRole(role: string | null | undefined): boolean {
  return normalizeRole(role) === "dev";
}
