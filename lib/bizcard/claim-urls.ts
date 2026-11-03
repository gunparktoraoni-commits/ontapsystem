/**
 * Client-safe claim / scan URL helpers (no DB or server-only imports).
 * Used by signup, login, merge, and AliasPage scan redirects so serial IDs
 * survive Safari ITP, Android Chrome, and auth bounces.
 */

import { isValidSerialId, normalizeSerialId } from "@/lib/bizcard/serial-id-format";

export const CLAIM_SERIAL_STORAGE_KEY = "assignedBizcardSerial";

export type ClaimSerialSource = "ref" | "serial" | "redirect" | "storage" | null;

/** Normalize and validate a candidate serial from any URL/storage source. */
export function extractClaimSerial(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = normalizeSerialId(raw);
  if (!normalized || !isValidSerialId(normalized)) return null;
  return normalized;
}

/**
 * Read claim serial from URLSearchParams (`ref`, `serial`) or a redirect path
 * that is itself `/{SERIAL}`.
 */
export function readClaimSerialFromSearchParams(
  searchParams: URLSearchParams | { get(name: string): string | null },
): string | null {
  const fromRef = extractClaimSerial(searchParams.get("ref"));
  if (fromRef) return fromRef;

  const fromSerial = extractClaimSerial(searchParams.get("serial"));
  if (fromSerial) return fromSerial;

  const redirect = searchParams.get("redirect");
  if (redirect) {
    const pathOnly = redirect.split("?")[0]?.trim() ?? "";
    const slug = pathOnly.replace(/^\/+/, "").split("/")[0] ?? "";
    const fromRedirect = extractClaimSerial(slug);
    if (fromRedirect) return fromRedirect;
  }

  return null;
}

/** Persist serial for Safari/Chrome private modes where query can be stripped. */
export function persistClaimSerial(serialId: string): void {
  const serial = extractClaimSerial(serialId);
  if (!serial || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CLAIM_SERIAL_STORAGE_KEY, serial);
  } catch {
    // Ignore quota / private-mode failures.
  }
  try {
    window.localStorage.setItem(CLAIM_SERIAL_STORAGE_KEY, serial);
  } catch {
    // Ignore.
  }
}

export function readPersistedClaimSerial(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const fromSession = extractClaimSerial(window.sessionStorage.getItem(CLAIM_SERIAL_STORAGE_KEY));
    if (fromSession) return fromSession;
  } catch {
    // Ignore.
  }
  try {
    return extractClaimSerial(window.localStorage.getItem(CLAIM_SERIAL_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Signup with serial visible in the query string. */
export function buildClaimSignupPath(serialId: string): string {
  const serial = extractClaimSerial(serialId);
  if (!serial) return "/user/signup";
  return `/user/signup?ref=${encodeURIComponent(serial)}`;
}

/**
 * Login with serial embedded. After auth, `redirect` re-runs NFC/QR routing
 * at `/{SERIAL}` so merge vs create-separate is classified with a live session.
 */
export function buildClaimLoginPath(serialId: string): string {
  const serial = extractClaimSerial(serialId);
  if (!serial) return "/";
  const redirect = `/${encodeURIComponent(serial)}`;
  return `/?serial=${encodeURIComponent(serial)}&redirect=${encodeURIComponent(redirect)}`;
}

/** Merge confirmation page for an authenticated user with unlinked virtual cards. */
export function buildClaimMergePath(serialId: string, virtualId?: string): string {
  const serial = extractClaimSerial(serialId);
  if (!serial) return "/";
  let path = `/scan/${encodeURIComponent(serial)}/merge`;
  if (virtualId) path += `?virtualId=${encodeURIComponent(virtualId)}`;
  return path;
}

/** Resolve the next page after explaining a blank physical-card scan. */
export function buildBlankCardNextPath(
  serialId: string,
  nextAction: string | null | undefined,
  virtualCardId?: string | null,
): string | null {
  switch (nextAction) {
    case "signup":
      return buildClaimSignupPath(serialId);
    case "manual_register":
      return buildClaimCreateSeparatePath(serialId);
    case "merge_choice":
      return virtualCardId
        ? buildClaimMergePath(serialId, virtualCardId)
        : buildClaimCreateSeparatePath(serialId);
    default:
      return null;
  }
}

/** Create a separate BizCard (setup) while claiming this physical serial. */
export function buildClaimCreateSeparatePath(serialId: string): string {
  const serial = extractClaimSerial(serialId);
  if (!serial) return "/user/bizcard/create-new";
  return `/user/bizcard/create-new?serial=${encodeURIComponent(serial)}`;
}

/**
 * Build a login bounce URL that preserves pathname + search (e.g. create-new?serial=).
 * Safe for proxy and client layout redirects.
 */
export function buildLoginRedirectPath(pathname: string, search = ""): string {
  const safePath = pathname.startsWith("/") && !pathname.startsWith("//") ? pathname : "/";
  const query = search.startsWith("?") ? search : search ? `?${search}` : "";
  const fullRedirect = `${safePath}${query}`;

  const params = new URLSearchParams();
  params.set("redirect", fullRedirect);

  const serialFromPath = extractClaimSerial(safePath.replace(/^\/+/, "").split("/")[0] ?? "");
  const serialFromQuery = readClaimSerialFromSearchParams(new URLSearchParams(query.replace(/^\?/, "")));
  const serial = serialFromQuery ?? serialFromPath;
  if (serial) params.set("serial", serial);

  return `/?${params.toString()}`;
}

/** Allow only same-origin relative paths (blocks open redirects). */
export function sanitizeInternalRedirectPath(raw: string | null | undefined): string | null {
  const redirect = String(raw ?? "").trim();
  if (!redirect.startsWith("/") || redirect.startsWith("//")) return null;
  return redirect;
}

/** Login URL that preserves an intended post-auth destination (and optional claim serial). */
export function buildLoginHrefWithRedirect(
  redirectPath?: string | null,
  serial?: string | null,
): string {
  const params = new URLSearchParams();
  const safeRedirect = sanitizeInternalRedirectPath(redirectPath);
  if (safeRedirect) params.set("redirect", safeRedirect);
  const claimSerial = extractClaimSerial(serial);
  if (claimSerial) params.set("serial", claimSerial);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

/** Signup URL that preserves an intended post-setup destination (and optional claim serial). */
export function buildSignupHrefWithRedirect(
  redirectPath?: string | null,
  serial?: string | null,
): string {
  const params = new URLSearchParams();
  const safeRedirect = sanitizeInternalRedirectPath(redirectPath);
  if (safeRedirect) params.set("redirect", safeRedirect);
  const claimSerial = extractClaimSerial(serial);
  if (claimSerial) {
    params.set("ref", claimSerial);
    params.set("serial", claimSerial);
  }
  const query = params.toString();
  return query ? `/user/signup?${query}` : "/user/signup";
}

/**
 * Resolve where to send the user after a successful login when a claim serial
 * may be present in the URL.
 *
 * Only explicit URL intent (`redirect` query or `serial` on the login URL)
 * overrides the dashboard. Persisted storage (`assignedBizcardSerial`) is
 * intentionally ignored here so a stale localStorage value from a prior blank
 * card scan cannot hijack a normal login to `/user/bizcard/create-new`.
 * Signup/claim flows that need the serial still read storage separately and
 * should put `serial`/`redirect` on the login URL when continuing a claim.
 */
export function resolvePostLoginClaimPath(options: {
  redirectPath: string | null;
  serialFromUrl: string | null;
  defaultDashboard: string;
}): string {
  const redirect = sanitizeInternalRedirectPath(options.redirectPath);
  if (redirect) {
    return redirect;
  }

  const serial = options.serialFromUrl;
  if (serial) {
    return `/${encodeURIComponent(serial)}`;
  }

  return options.defaultDashboard;
}

/** Classify blank-card routing intent for UI copy and analytics. */
export type BlankCardRouteKind = "signup" | "merge_choice" | "create_separate" | "show_portfolio" | "unknown";

export function classifyBlankCardNextAction(
  nextAction: string | null | undefined,
): BlankCardRouteKind {
  switch (nextAction) {
    case "signup":
      return "signup";
    case "merge_choice":
      return "merge_choice";
    case "manual_register":
      return "create_separate";
    case "show_portfolio":
      return "show_portfolio";
    default:
      return "unknown";
  }
}
