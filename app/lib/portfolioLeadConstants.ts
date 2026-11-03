export const PORTFOLIO_LEAD_STATUSES = [
  "new",
  "contacted",
  "follow_up",
  "qualified",
  "closed",
  "spam",
] as const;

export type PortfolioLeadStatus = (typeof PORTFOLIO_LEAD_STATUSES)[number];

export const PORTFOLIO_LEAD_STATUS_LABELS: Record<PortfolioLeadStatus, string> = {
  new: "New",
  contacted: "Reached out",
  follow_up: "Follow up",
  qualified: "Qualified",
  closed: "Closed",
  spam: "Spam",
};

export const PORTFOLIO_LEAD_INTERESTS = ["call", "email", "meet"] as const;

export type PortfolioLeadInterest = (typeof PORTFOLIO_LEAD_INTERESTS)[number];

/** Max length for owner-only follow-up notes (stored as TEXT). */
export const PORTFOLIO_LEAD_OWNER_NOTES_MAX = 2000;

export function isPortfolioLeadStatus(value: string): value is PortfolioLeadStatus {
  return (PORTFOLIO_LEAD_STATUSES as readonly string[]).includes(value);
}

export function isPortfolioLeadInterest(value: string): value is PortfolioLeadInterest {
  return (PORTFOLIO_LEAD_INTERESTS as readonly string[]).includes(value);
}

/** Strip tags/control chars and cap length for owner notes. */
export function sanitizePortfolioLeadOwnerNotes(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, PORTFOLIO_LEAD_OWNER_NOTES_MAX);
  return cleaned || null;
}
