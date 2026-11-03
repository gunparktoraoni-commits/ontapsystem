/**
 * User-facing notice copy — plain language for non-technical users.
 */

export type NoticeKind = "success" | "error" | "info";

function extractMessage(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input.trim();
  if (input instanceof Error) return input.message.trim();
  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;
    const nested =
      (typeof obj.message === "string" && obj.message) ||
      (typeof obj.error === "string" && obj.error) ||
      (obj.error &&
        typeof obj.error === "object" &&
        typeof (obj.error as Record<string, unknown>).message === "string" &&
        (obj.error as Record<string, unknown>).message) ||
      (typeof obj.details === "string" && obj.details);
    if (typeof nested === "string") return nested.trim();
  }
  return String(input).trim();
}

function looksTechnical(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    /^\d{3}\b/.test(message) ||
    lower.includes("exception") ||
    lower.includes("stack trace") ||
    lower.includes("undefined") ||
    lower.includes("null pointer") ||
    lower.includes("internal server") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("syntaxerror") ||
    lower.includes("typeerror") ||
    lower.includes("referenceerror") ||
    message.includes("{") ||
    message.includes("}") ||
    lower.startsWith("error:") ||
    lower.includes("prisma") ||
    lower.includes("sql") ||
    lower.includes("jwt")
  );
}

const ERROR_PATTERNS: Array<{ test: (msg: string) => boolean; message: string }> = [
  {
    test: (m) =>
      /failed to fetch|network error|network request failed|load failed/i.test(m),
    message:
      "We couldn't reach our servers. Please check your internet connection and try again.",
  },
  {
    test: (m) =>
      /401|unauthorized|session expired|not authenticated|sign in again/i.test(m),
    message: "Your session has expired. Please sign in again to continue.",
  },
  {
    test: (m) => /403|forbidden|permission denied|not allowed|do not have permission/i.test(m),
    message:
      "You don't have permission to do that. If you need access, please contact your administrator.",
  },
  {
    test: (m) => /404|not found/i.test(m),
    message:
      "We couldn't find what you're looking for. It may have been removed or moved.",
  },
  {
    test: (m) => /500|502|503|504|internal server|service unavailable/i.test(m),
    message:
      "Something went wrong on our end. Please wait a moment and try again.",
  },
  {
    test: (m) => /timeout|timed out/i.test(m),
    message: "That took too long to complete. Please try again.",
  },
  {
    test: (m) => /csrf|token expired|invalid token/i.test(m),
    message: "For your security, please refresh the page and try again.",
  },
  {
    test: (m) => /validation|invalid|required|must be|cannot be empty/i.test(m),
    message: "", // keep original — usually field-specific and user-friendly
  },
];

export function friendlyErrorMessage(
  input: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  const raw = extractMessage(input);
  if (!raw) return fallback;

  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test(raw) && pattern.message) return pattern.message;
  }

  if (looksTechnical(raw)) return fallback;
  return raw;
}

export function friendlySuccessMessage(
  input: unknown,
  fallback = "Done! Your changes were saved successfully.",
): string {
  const raw = extractMessage(input);
  if (!raw) return fallback;
  if (looksTechnical(raw)) return fallback;
  return raw;
}

export function friendlyInfoMessage(
  input: unknown,
  fallback = "Here's an update you should know about.",
): string {
  const raw = extractMessage(input);
  if (!raw) return fallback;
  if (looksTechnical(raw)) return fallback;
  return raw;
}

export function formatNoticeMessage(
  input: unknown,
  kind: NoticeKind,
  fallback?: string,
): string {
  switch (kind) {
    case "error":
      return friendlyErrorMessage(input, fallback);
    case "success":
      return friendlySuccessMessage(input, fallback);
    default:
      return friendlyInfoMessage(input, fallback);
  }
}

/** Common reusable copy for consistent UX across the app. */
export const USER_NOTICES = {
  saved: "Your changes were saved successfully.",
  copied: "Copied to your clipboard.",
  deleted: "Removed successfully.",
  sent: "Your message was sent. We'll get back to you soon.",
  addedToCart: "Added to your cart.",
  orderPlaced:
    "Your order was placed successfully. We'll contact you with the next steps.",
  inquirySent:
    "Your inquiry was sent. Our team will reach out to you shortly.",
  sessionExpired: "Your session has expired. Please sign in again.",
  networkError:
    "We couldn't connect right now. Check your internet and try again.",
  permissionDenied:
    "You don't have permission to do that. Contact your administrator if you need help.",
  requiredFields: "Please fill in all required fields before continuing.",
  selectOne: "Please select at least one item to continue.",
  tryAgain: "Something went wrong. Please try again.",
} as const;
