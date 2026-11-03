import {
  SuperAdminErrorCode,
  createSuperAdminError,
} from "@/lib/errors/superadmin-errors";
import {
  type SuperAdminDateFilter,
  resolveSuperAdminDateRange,
  validateSuperAdminDateRange,
} from "@/lib/utils/superadmin-date-range";

const DATE_FILTERS = new Set<SuperAdminDateFilter>([
  "today",
  "yesterday",
  "this_week",
  "this_month",
  "custom",
]);

export function parsePositiveInt(
  value: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function parsePagination(
  params: URLSearchParams,
  fallbackLimit: number = 20,
  maxLimit: number = 100
): { page: number; limit: number } {
  return {
    page: parsePositiveInt(params.get("page"), 1, 1, 100000),
    limit: parsePositiveInt(params.get("limit"), fallbackLimit, 1, maxLimit),
  };
}

export function parseSuperAdminDateRangeFromSearchParams(
  params: URLSearchParams,
  requestId: string,
  options?: {
    defaultFilter?: SuperAdminDateFilter;
    maxDays?: number;
  }
) {
  const maxDays = options?.maxDays ?? 90;
  const defaultFilter = options?.defaultFilter ?? "today";
  const rawFilter = (params.get("date_filter") ?? defaultFilter).trim().toLowerCase();
  if (!DATE_FILTERS.has(rawFilter as SuperAdminDateFilter)) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_DATE_FILTER,
      "Invalid date_filter",
      400,
      requestId,
      {
        date_filter: rawFilter,
        allowed: [...DATE_FILTERS],
      }
    );
  }

  const timezone = params.get("timezone")?.trim() || "UTC";
  const customStartDate = params.get("custom_start_date")?.trim() || undefined;
  const customEndDate = params.get("custom_end_date")?.trim() || undefined;

  try {
    const range = resolveSuperAdminDateRange(
      rawFilter as SuperAdminDateFilter,
      customStartDate,
      customEndDate,
      timezone
    );

    if (!validateSuperAdminDateRange(range, maxDays)) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_DATE_RANGE,
        `Date range exceeds maximum of ${maxDays} days`,
        400,
        requestId,
        {
          max_days: maxDays,
          filter_type: range.filterType,
          timezone: range.timezone,
        }
      );
    }

    return range;
  } catch (error) {
    if (error instanceof Error && "code" in error && String((error as { code?: string }).code).startsWith("SUPERADMIN_")) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "Invalid date filter configuration";
    const code = message.toLowerCase().includes("timezone")
      ? SuperAdminErrorCode.INVALID_TIMEZONE
      : message.toLowerCase().includes("custom") || message.toLowerCase().includes("date")
        ? SuperAdminErrorCode.INVALID_DATE_RANGE
        : SuperAdminErrorCode.INVALID_DATE_FILTER;

    throw createSuperAdminError(code, message, 400, requestId, {
      date_filter: rawFilter,
      timezone,
      custom_start_date: customStartDate ?? null,
      custom_end_date: customEndDate ?? null,
    });
  }
}
