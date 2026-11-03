/**
 * Temporary / provisional account emails that must be replaced after login.
 * Matches: pco01@gmail.com, pco02@gmail.com, pco123@gmail.com, etc.
 */
const PLACEHOLDER_EMAIL_PATTERN = /^pco\d+@gmail\.com$/i;

export function isForcedPlaceholderEmail(email: string | null | undefined): boolean {
  const normalized = String(email ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return PLACEHOLDER_EMAIL_PATTERN.test(normalized);
}

export function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}
