import { ClientErrorCode, createClientError } from "@/lib/errors/client-errors";

export type ClientDateFilter = "all" | "today" | "this_week" | "this_month" | "last_month" | "custom";

export interface ClientDateRange {
  start: Date;
  end: Date;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[0-9+\-()\s.]{1,20}$/;

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function parseDateInput(value: string | undefined, fieldName: string, requestId: string): Date {
  if (!value) {
    throw createClientError(
      ClientErrorCode.INVALID_PAGINATION,
      `${fieldName} is required for custom date_filter`,
      400,
      requestId,
      { field: fieldName }
    );
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw createClientError(
      ClientErrorCode.INVALID_PAGINATION,
      `${fieldName} must be a valid date`,
      400,
      requestId,
      { field: fieldName, value }
    );
  }

  return parsed;
}

export function normalizeClientAltEmail(value: string, requestId: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized.length > 191) {
    throw createClientError(
      ClientErrorCode.INVALID_PAGINATION,
      "alt_email must not exceed 191 characters",
      400,
      requestId,
      { field: "alt_email", maxLength: 191 }
    );
  }

  if (!EMAIL_REGEX.test(normalized)) {
    throw createClientError(
      ClientErrorCode.INVALID_PAGINATION,
      "alt_email must be a valid email address",
      400,
      requestId,
      { field: "alt_email", value: normalized }
    );
  }

  return normalized;
}

export function normalizeClientPhone(value: string, requestId: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;

  if (normalized.length > 20) {
    throw createClientError(
      ClientErrorCode.INVALID_PAGINATION,
      "phone must not exceed 20 characters",
      400,
      requestId,
      { field: "phone", maxLength: 20 }
    );
  }

  if (!PHONE_REGEX.test(normalized)) {
    throw createClientError(
      ClientErrorCode.INVALID_PAGINATION,
      "phone must contain only digits, spaces, and the characters: + - ( ) .",
      400,
      requestId,
      { field: "phone", value: normalized }
    );
  }

  return normalized;
}

export function resolveClientExportDateRange(
  dateFilter: ClientDateFilter | undefined,
  startDate: string | undefined,
  endDate: string | undefined,
  requestId: string
): ClientDateRange | undefined {
  const normalized = (dateFilter ?? "all").toLowerCase();
  const now = new Date();

  if (normalized === "all") {
    return undefined;
  }

  if (normalized === "today") {
    return {
      start: startOfDay(now),
      end: endOfDay(now),
    };
  }

  if (normalized === "this_week") {
    const start = new Date(now);
    const day = start.getDay();
    start.setDate(start.getDate() - day);
    return {
      start: startOfDay(start),
      end: endOfDay(now),
    };
  }

  if (normalized === "this_month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      start: startOfDay(start),
      end: endOfDay(now),
    };
  }

  if (normalized === "last_month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      start: startOfDay(start),
      end: endOfDay(end),
    };
  }

  if (normalized === "custom") {
    const parsedStart = parseDateInput(startDate, "start_date", requestId);
    const parsedEnd = parseDateInput(endDate, "end_date", requestId);
    const start = startOfDay(parsedStart);
    const end = endOfDay(parsedEnd);

    if (start.getTime() > end.getTime()) {
      throw createClientError(
        ClientErrorCode.INVALID_PAGINATION,
        "start_date must be less than or equal to end_date",
        400,
        requestId,
        { start_date: startDate, end_date: endDate }
      );
    }

    return { start, end };
  }

  throw createClientError(
    ClientErrorCode.INVALID_PAGINATION,
    "Invalid date_filter. Allowed: all, today, this_week, this_month, last_month, custom",
    400,
    requestId,
    { date_filter: dateFilter }
  );
}
