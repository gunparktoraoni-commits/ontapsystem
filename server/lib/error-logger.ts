// ──────────────────────────────────────────────────────────────
// Error Logging Service — Client-Side Error Monitoring
// ──────────────────────────────────────────────────────────────
// Receives, classifies, and persists frontend runtime errors.
//
// Severity Classification Logic:
// ─────────────────────────────────────────────────────────────
// Severity is auto-classified based on the error message content
// and origins. Callers may also send an explicit severity, which
// is accepted if it matches our allow-list.
//
// AUTO-CLASSIFICATION RULES (applied when severity = "low" default):
//
//   CRITICAL — System-breaking. User cannot continue.
//     Signals: "uncaught", "unhandledrejection", "Cannot read properties of undefined",
//              "Cannot read property", "is not a function", "Maximum call stack"
//
//   HIGH — Critical feature failure. Core functionality broken.
//     Signals: "TypeError", "ReferenceError", "fetch failed",
//              "NetworkError", "Failed to fetch", "SyntaxError"
//
//   MEDIUM — Functional interruption. Feature impaired but app still usable.
//     Signals: "404", "403", "500", "timeout", "abort",
//              "ResizeObserver", "Promise"
//
//   LOW — Minor / cosmetic issues. No functional impact.
//     Everything else defaults to LOW.
//
// Why auto-classification?
//   Frontend developers may not always send severity. Auto-classification
//   ensures errors are triaged correctly even when the frontend integration
//   is minimal or incomplete.
// ──────────────────────────────────────────────────────────────

import { prismaAnalytics } from "./prisma-analytics";
import type { ErrorLogInput } from "./validators";

// ──────────────────────────────────────────
// Severity Classification
// ──────────────────────────────────────────

type SeverityLevel = "low" | "medium" | "high" | "critical";

/**
 * Auto-classify error severity based on error message and stack trace content.
 *
 * Pattern matching is intentionally conservative — when in doubt we escalate.
 * The classification result can be overridden by the caller's explicit severity
 * if it's higher than the auto-classified value.
 */
export function classifySeverity(
  errorMessage: string,
  stackTrace: string | null,
  explicitSeverity: SeverityLevel
): SeverityLevel {
  const combined = `${errorMessage} ${stackTrace ?? ""}`.toLowerCase();

  // CRITICAL — app-breaking signals
  const criticalPatterns = [
    "uncaught",
    "unhandledrejection",
    "maximum call stack",
    "cannot read properties of undefined",
    "cannot read property",
    "is not a function",
    "is not defined",
    "script error",              // Cross-origin script errors (very opaque)
    "out of memory",
    "webassembly",
  ];

  // HIGH — core feature broken
  const highPatterns = [
    "typeerror",
    "referenceerror",
    "fetch failed",
    "networkerror",
    "failed to fetch",
    "syntaxerror",
    "evalerror",
    "rangeerror",
    "urierror",
    "chunkloaderror",            // Next.js chunk load failures
    "loading chunk",
    "hydration",                 // React hydration mismatches break SSR
  ];

  // MEDIUM — functional issue
  const mediumPatterns = [
    "404",
    "403",
    "500",
    "502",
    "503",
    "timeout",
    "aborted",
    "abort",
    "promise",
    "resizeobserver",            // Layout errors — annoying but not breaking
    "intersectionobserver",
    "storage",                   // localStorage/sessionStorage errors
    "quota",
  ];

  let autoSeverity: SeverityLevel = "low";

  if (mediumPatterns.some((p) => combined.includes(p))) autoSeverity = "medium";
  if (highPatterns.some((p) => combined.includes(p))) autoSeverity = "high";
  if (criticalPatterns.some((p) => combined.includes(p))) autoSeverity = "critical";

  // Take the higher of explicit vs auto-classified
  const severityRank: Record<SeverityLevel, number> = {
    low: 0, medium: 1, high: 2, critical: 3,
  };

  return severityRank[explicitSeverity] > severityRank[autoSeverity]
    ? explicitSeverity
    : autoSeverity;
}

// ──────────────────────────────────────────
// Log Persistence
// ──────────────────────────────────────────

/**
 * Persist a validated client error to the SystemErrorLog table.
 *
 * @param input    - Validated & sanitized error payload from the API route
 * @param userId   - Authenticated user's ID (null for unauthenticated users)
 *
 * The caller (API route) is responsible for validation.
 * This function only handles classification and DB write.
 */
export async function logClientError(
  input: ErrorLogInput,
  userId: number | null
): Promise<void> {
  // Final severity — may upgrade based on error content
  const severity = classifySeverity(
    input.errorMessage,
    input.stackTrace,
    input.severity
  );

  await prismaAnalytics.systemErrorLog.create({
    data: {
      session_id: input.sessionId,
      user_id: userId ? BigInt(userId) : null,
      error_message: input.errorMessage,
      stack_trace: input.stackTrace,
      file_name: input.fileName,
      line_number: input.lineNumber,
      col_number: input.colNumber,
      browser_info: input.browserInfo,
      device_info: input.deviceInfo,
      page_url: input.pageUrl,
      severity_level: severity,
    },
  });
}

/**
 * List system error logs for the developer portal.
 */
export async function listSystemErrorLogs(options: {
  severity?: string;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<{
  items: Array<{
    id: string;
    message: string;
    source: string;
    timestamp: string;
    severity: "Critical" | "High" | "Medium" | "Low";
    pageUrl: string | null;
    userId: string | null;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  const searchWhere: Record<string, unknown> = {};
  const severity = options.severity?.trim().toLowerCase();
  if (severity && severity !== "all") {
    where.severity_level = severity;
  }
  const search = options.search?.trim();
  if (search) {
    const searchClause = {
      OR: [
        { error_message: { contains: search } },
        { file_name: { contains: search } },
        { page_url: { contains: search } },
      ],
    };
    Object.assign(where, searchClause);
    Object.assign(searchWhere, searchClause);
  }

  const [rows, total, critical, high, medium, low] = await Promise.all([
    prismaAnalytics.systemErrorLog.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        error_message: true,
        file_name: true,
        page_url: true,
        severity_level: true,
        created_at: true,
        user_id: true,
      },
    }),
    prismaAnalytics.systemErrorLog.count({ where }),
    prismaAnalytics.systemErrorLog.count({
      where: { ...searchWhere, severity_level: "critical" },
    }),
    prismaAnalytics.systemErrorLog.count({
      where: { ...searchWhere, severity_level: "high" },
    }),
    prismaAnalytics.systemErrorLog.count({
      where: { ...searchWhere, severity_level: "medium" },
    }),
    prismaAnalytics.systemErrorLog.count({
      where: { ...searchWhere, severity_level: "low" },
    }),
  ]);

  const capitalize = (s: string): "Critical" | "High" | "Medium" | "Low" => {
    const n = s.toLowerCase();
    if (n === "critical") return "Critical";
    if (n === "high") return "High";
    if (n === "medium") return "Medium";
    return "Low";
  };

  return {
    items: rows.map(
      (row: {
        id: bigint;
        error_message: string;
        file_name: string | null;
        page_url: string | null;
        severity_level: string;
        created_at: Date;
        user_id: bigint | null;
      }) => ({
        id: `ERR-${row.id.toString()}`,
        message: row.error_message,
        source: row.file_name || row.page_url || "unknown",
        timestamp: row.created_at.toISOString(),
        severity: capitalize(row.severity_level),
        pageUrl: row.page_url,
        userId: row.user_id != null ? row.user_id.toString() : null,
      }),
    ),
    pagination: {
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    },
    summary: {
      total: Number(critical) + Number(high) + Number(medium) + Number(low),
      critical,
      high,
      medium,
      low,
    },
  };
}