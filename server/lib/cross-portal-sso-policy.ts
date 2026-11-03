import crypto from "node:crypto";

/**
 * Pure helpers for the OnTap ↔ SmartPet superadmin single sign-on flows.
 * No database or framework imports so every rule here is unit-testable.
 */

export const CROSS_PORTAL_SUPERADMIN_ROLES = ["super_admin", "dev"] as const;

export const SSO_STATE_COOKIE_NAME = "xp_sso_state";
export const SSO_STATE_COOKIE_PATH = "/api/auth/cross-portal";
export const SSO_STATE_TTL_SECONDS = 300;

export const HANDOFF_TICKET_TTL_SECONDS = 60;
export const HANDOFF_TICKET_USER_AGENT_PREFIX = "xp-handoff:";

export const DEFAULT_SUPERADMIN_REDIRECT = "/superadmin/dashboard";

const RANDOM_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const TICKET_HASH_DOMAIN = "ontap-cross-portal-handoff-ticket:";
const MAX_REDIRECT_LENGTH = 512;
const ALLOWED_REDIRECT_PREFIXES = ["/superadmin", "/dev"];

export function isCrossPortalSuperadminRole(role: unknown): boolean {
  if (typeof role !== "string") return false;
  const normalized = role.trim().toLowerCase();
  return (CROSS_PORTAL_SUPERADMIN_ROLES as readonly string[]).includes(normalized);
}

export function generateRandomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function isValidSsoState(value: unknown): value is string {
  return typeof value === "string" && RANDOM_TOKEN_PATTERN.test(value);
}

export function isValidHandoffTicket(value: unknown): value is string {
  return typeof value === "string" && RANDOM_TOKEN_PATTERN.test(value);
}

export function isValidStateHash(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX_PATTERN.test(value);
}

export function hashSsoState(state: string): string {
  return crypto.createHash("sha256").update(state).digest("hex");
}

/**
 * Domain-separated hash so a handoff ticket can never collide with (or be
 * replayed as) a regular session token, whose hash is plain SHA-256.
 */
export function hashHandoffTicket(ticket: string): string {
  return crypto.createHash("sha256").update(`${TICKET_HASH_DOMAIN}${ticket}`).digest("hex");
}

export function handoffTicketUserAgent(stateHash: string): string {
  return `${HANDOFF_TICKET_USER_AGENT_PREFIX}${stateHash}`;
}

/**
 * Only allow same-origin superadmin portal paths as post-login targets.
 * Anything else (absolute URLs, protocol-relative, backslashes, control
 * characters, other portals) falls back to the dashboard.
 */
export function sanitizeSuperadminRedirect(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_SUPERADMIN_REDIRECT;
  const value = raw.trim();
  if (!value || value.length > MAX_REDIRECT_LENGTH) return DEFAULT_SUPERADMIN_REDIRECT;
  if (!value.startsWith("/") || value.startsWith("//")) return DEFAULT_SUPERADMIN_REDIRECT;
  if (value.includes("\\") || value.includes("://") || /[\u0000-\u001f\u007f]/.test(value)) {
    return DEFAULT_SUPERADMIN_REDIRECT;
  }

  const pathOnly = value.split(/[?#]/, 1)[0] ?? "";
  if (pathOnly.split("/").some((segment) => segment === ".." || segment === ".")) {
    return DEFAULT_SUPERADMIN_REDIRECT;
  }

  const allowed = ALLOWED_REDIRECT_PREFIXES.some(
    (prefix) => pathOnly === prefix || pathOnly.startsWith(`${prefix}/`),
  );
  return allowed ? value : DEFAULT_SUPERADMIN_REDIRECT;
}

export function encodeStateCookie(state: string, redirect: string): string {
  return `${state}.${Buffer.from(sanitizeSuperadminRedirect(redirect), "utf8").toString("base64url")}`;
}

export function decodeStateCookie(raw: unknown): { state: string; redirect: string } | null {
  if (typeof raw !== "string" || raw.length > 1024) return null;
  const separator = raw.indexOf(".");
  if (separator <= 0) return null;

  const state = raw.slice(0, separator);
  if (!isValidSsoState(state)) return null;

  let redirect = DEFAULT_SUPERADMIN_REDIRECT;
  try {
    redirect = sanitizeSuperadminRedirect(
      Buffer.from(raw.slice(separator + 1), "base64url").toString("utf8"),
    );
  } catch {
    redirect = DEFAULT_SUPERADMIN_REDIRECT;
  }

  return { state, redirect };
}

export function safeOrigin(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * The browser-supplied Referer is not forgeable by a third-party page (it can
 * only be stripped), so requiring it to match the partner origin blocks
 * attacker-initiated SSO hops that could leak a token to the wrong session.
 */
export function isTrustedReferrer(referrer: unknown, expectedOrigin: string | null): boolean {
  if (!expectedOrigin) return false;
  const origin = safeOrigin(referrer);
  return origin !== null && origin === expectedOrigin;
}
