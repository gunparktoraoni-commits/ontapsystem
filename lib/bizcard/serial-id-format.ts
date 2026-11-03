/** Shared serial ID format rules (no DB imports — safe for client bundles). */

export const SERIAL_ID_REGEX = /^[A-HJ-NP-Z2-9]{6}$/;

export function normalizeSerialId(serialId: string): string | null {
  if (!serialId || typeof serialId !== "string") return null;
  const normalized = serialId.trim().toUpperCase().replace(/\s+/g, "");
  if (normalized.length === 0) return null;
  return normalized;
}

export function isValidSerialId(serialId: string): boolean {
  const normalized = normalizeSerialId(serialId);
  if (!normalized) return false;
  return SERIAL_ID_REGEX.test(normalized);
}

/**
 * True when the slug is an issued physical-card serial (uppercase on cards/NFC).
 * Lowercase 6-char slugs like "bambam" are custom URL aliases, not serial scans.
 */
export function isLikelyPhysicalSerialSlug(alias: string): boolean {
  const trimmed = alias.trim();
  if (!trimmed || /[a-z]/.test(trimmed)) return false;
  return isValidSerialId(trimmed);
}
