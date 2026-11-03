/**
 * Shared social-link URL normalization and deduplication.
 * Used by validators, portfolio display, edit UI, and cleanup scripts.
 */

/** Canonical key for comparing two social URLs (case, www, trailing slash). */
export function normalizeSocialUrlKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed.replace(/^\/\//, "")}`;
    const parsed = new URL(withProtocol);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "") || "";
    const search = parsed.search;
    const hash = parsed.hash;
    return `${host}${path}${search}${hash}`.toLowerCase();
  } catch {
    return trimmed
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, "");
  }
}

export function socialUrlsEqual(a: string, b: string): boolean {
  const ka = normalizeSocialUrlKey(a);
  const kb = normalizeSocialUrlKey(b);
  if (!ka || !kb) return false;
  return ka === kb;
}

/**
 * Keep the first occurrence of each normalized URL.
 * Empty URLs are kept as-is (caller decides whether to filter them).
 */
export function dedupeSocialLinksByUrl<T>(
  links: T[],
  getUrl: (link: T) => string,
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const link of links) {
    const key = normalizeSocialUrlKey(getUrl(link));
    if (!key) {
      result.push(link);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(link);
  }

  return result;
}

/** True when `candidateUrl` already exists in `links` (optionally ignoring one id). */
export function hasDuplicateSocialUrl<T extends { id?: number | string; url: string }>(
  links: T[],
  candidateUrl: string,
  options?: { ignoreId?: number | string },
): boolean {
  const key = normalizeSocialUrlKey(candidateUrl);
  if (!key) return false;

  return links.some((link) => {
    if (
      options?.ignoreId !== undefined &&
      link.id !== undefined &&
      String(link.id) === String(options.ignoreId)
    ) {
      return false;
    }
    return normalizeSocialUrlKey(link.url) === key;
  });
}
