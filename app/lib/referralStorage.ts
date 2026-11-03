/**
 * Client-side affiliate referral persistence.
 * Untrusted storage — checkout always re-validates server-side.
 */

export const AFFILIATE_REFERRAL_STORAGE_KEY = "affiliate_referral_code";
export const AFFILIATE_REF_COOKIE = "__affiliate_ref";

export function normalizeReferralCode(code: string | null | undefined): string {
  return String(code ?? "").trim().toUpperCase();
}

export function getStoredReferralCode(): string {
  if (typeof window === "undefined") return "";
  try {
    return normalizeReferralCode(
      window.localStorage.getItem(AFFILIATE_REFERRAL_STORAGE_KEY),
    );
  } catch {
    return "";
  }
}

/**
 * Persist a referral code. Never clears with empty/null.
 * Replaces only when a new non-empty code is provided.
 */
function resolveSharedCookieDomain(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const host = window.location.hostname.toLowerCase();
  if (host === "ontap.ph" || host.endsWith(".ontap.ph")) {
    return ".ontap.ph";
  }
  return undefined;
}

export function setStoredReferralCode(code: string | null | undefined): string {
  const normalized = normalizeReferralCode(code);
  if (!normalized || typeof window === "undefined") {
    return getStoredReferralCode();
  }
  try {
    window.localStorage.setItem(AFFILIATE_REFERRAL_STORAGE_KEY, normalized);
  } catch {
    // ignore quota / private mode
  }
  try {
    const maxAge = 30 * 24 * 60 * 60;
    const domain = resolveSharedCookieDomain();
    const domainPart = domain ? `; domain=${domain}` : "";
    document.cookie = `${AFFILIATE_REF_COOKIE}=${encodeURIComponent(normalized)}; path=/; max-age=${maxAge}; samesite=lax${domainPart}`;
  } catch {
    // ignore cookie write failures
  }
  return normalized;
}

export function readReferralCookie(): string {
  if (typeof document === "undefined") return "";
  try {
    const match = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${AFFILIATE_REF_COOKIE}=`));
    if (!match) return "";
    return normalizeReferralCode(
      decodeURIComponent(match.slice(AFFILIATE_REF_COOKIE.length + 1)),
    );
  } catch {
    return "";
  }
}

export function resolvePersistedReferralCode(
  preferred?: string | null,
): string {
  const fromPreferred = normalizeReferralCode(preferred);
  if (fromPreferred) return setStoredReferralCode(fromPreferred);
  return getStoredReferralCode() || readReferralCookie();
}
