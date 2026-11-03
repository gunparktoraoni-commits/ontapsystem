import { assertValidTimezone, getZonedDateParts } from "@/lib/utils/date-range";

export type SuperAdminDateFilter = "today" | "yesterday" | "this_week" | "this_month" | "custom";

interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
}

export interface SuperAdminDateRange {
  filterType: SuperAdminDateFilter;
  timezone: string;
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  label: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const zonedDateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getZonedDateTimeFormatter(timezone: string): Intl.DateTimeFormat {
  const cacheKey = `datetime:${timezone}`;
  const existing = zonedDateTimeFormatterCache.get(cacheKey);
  if (existing) return existing;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  zonedDateTimeFormatterCache.set(cacheKey, formatter);
  return formatter;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function toIsoDate(parts: ZonedDateParts): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function addDays(parts: ZonedDateParts, delta: number): ZonedDateParts {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + delta));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function compareDateParts(a: ZonedDateParts, b: ZonedDateParts): number {
  const aValue = Date.UTC(a.year, a.month - 1, a.day);
  const bValue = Date.UTC(b.year, b.month - 1, b.day);
  if (aValue === bValue) return 0;
  return aValue < bValue ? -1 : 1;
}

function getDateSpanInclusive(start: ZonedDateParts, end: ZonedDateParts): number {
  const startUtc = Date.UTC(start.year, start.month - 1, start.day);
  const endUtc = Date.UTC(end.year, end.month - 1, end.day);
  return Math.floor((endUtc - startUtc) / DAY_MS) + 1;
}

function parseIsoDateParts(input: string): ZonedDateParts | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;

  const [yearRaw, monthRaw, dayRaw] = input.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function getTimeZoneOffsetMs(date: Date, timezone: string): number {
  const parts = getZonedDateTimeFormatter(timezone).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
    0
  );

  return asUtc - date.getTime();
}

function zonedDateTimeToUtc(
  date: ZonedDateParts,
  time: { hour: number; minute: number; second: number; millisecond: number },
  timezone: string
): Date {
  const utcGuess = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    time.hour,
    time.minute,
    time.second,
    time.millisecond
  );

  const firstOffset = getTimeZoneOffsetMs(new Date(utcGuess), timezone);
  let adjusted = utcGuess - firstOffset;

  const secondOffset = getTimeZoneOffsetMs(new Date(adjusted), timezone);
  if (firstOffset !== secondOffset) {
    adjusted = utcGuess - secondOffset;
  }

  return new Date(adjusted);
}

function startOfZonedDay(parts: ZonedDateParts, timezone: string): Date {
  return zonedDateTimeToUtc(parts, { hour: 0, minute: 0, second: 0, millisecond: 0 }, timezone);
}

function endOfZonedDay(parts: ZonedDateParts, timezone: string): Date {
  const nextDay = addDays(parts, 1);
  return new Date(startOfZonedDay(nextDay, timezone).getTime() - 1);
}

function getPreviousWindow(
  currentStart: ZonedDateParts,
  currentEnd: ZonedDateParts
): { previousStart: ZonedDateParts; previousEnd: ZonedDateParts } {
  const spanDays = getDateSpanInclusive(currentStart, currentEnd);
  const previousEnd = addDays(currentStart, -1);
  const previousStart = addDays(previousEnd, -(spanDays - 1));
  return { previousStart, previousEnd };
}

export function resolveSuperAdminDateRange(
  filterType: SuperAdminDateFilter,
  customStartDate?: string,
  customEndDate?: string,
  timezone: string = "UTC"
): SuperAdminDateRange {
  assertValidTimezone(timezone);
  const today = getZonedDateParts(new Date(), timezone);

  let startParts: ZonedDateParts;
  let endParts: ZonedDateParts;
  let label: string;

  switch (filterType) {
    case "today": {
      startParts = today;
      endParts = today;
      label = "Today";
      break;
    }
    case "yesterday": {
      const yesterday = addDays(today, -1);
      startParts = yesterday;
      endParts = yesterday;
      label = "Yesterday";
      break;
    }
    case "this_week": {
      const utcDayOfWeek = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
      const daysSinceMonday = (utcDayOfWeek + 6) % 7;
      startParts = addDays(today, -daysSinceMonday);
      endParts = today;
      label = "This Week";
      break;
    }
    case "this_month": {
      startParts = { year: today.year, month: today.month, day: 1 };
      endParts = today;
      label = "This Month";
      break;
    }
    case "custom": {
      if (!customStartDate || !customEndDate) {
        throw new Error("Custom date range requires custom_start_date and custom_end_date");
      }

      const parsedStart = parseIsoDateParts(customStartDate);
      const parsedEnd = parseIsoDateParts(customEndDate);
      if (!parsedStart || !parsedEnd) {
        throw new Error("Custom date range must use YYYY-MM-DD format");
      }
      if (compareDateParts(parsedStart, parsedEnd) > 0) {
        throw new Error("custom_start_date must be before or equal to custom_end_date");
      }

      startParts = parsedStart;
      endParts = parsedEnd;
      label = `${customStartDate} to ${customEndDate}`;
      break;
    }
    default: {
      throw new Error(`Unsupported date_filter: ${filterType}`);
    }
  }

  const previousWindow = getPreviousWindow(startParts, endParts);

  return {
    filterType,
    timezone,
    start: startOfZonedDay(startParts, timezone),
    end: endOfZonedDay(endParts, timezone),
    previousStart: startOfZonedDay(previousWindow.previousStart, timezone),
    previousEnd: endOfZonedDay(previousWindow.previousEnd, timezone),
    label,
  };
}

export function validateSuperAdminDateRange(range: SuperAdminDateRange, maxDays: number = 90): boolean {
  if (range.start.getTime() > range.end.getTime()) return false;
  const spanDays = Math.floor((range.end.getTime() - range.start.getTime()) / DAY_MS) + 1;
  return spanDays <= maxDays;
}

export function calculatePercentageChange(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return Math.round((((current - previous) / Math.abs(previous)) * 100) * 100) / 100;
}

export function getTrendDirection(current: number, previous: number): "up" | "down" | "same" {
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "same";
}

export function formatDateRangeMeta(range: SuperAdminDateRange): {
  current: { start: string; end: string };
  previous: { start: string; end: string };
  timezone: string;
  filter_type: SuperAdminDateFilter;
} {
  return {
    current: {
      start: range.start.toISOString(),
      end: range.end.toISOString(),
    },
    previous: {
      start: range.previousStart.toISOString(),
      end: range.previousEnd.toISOString(),
    },
    timezone: range.timezone,
    filter_type: range.filterType,
  };
}

export function toIsoDateInTimezone(date: Date, timezone: string): string {
  assertValidTimezone(timezone);
  return toIsoDate(getZonedDateParts(date, timezone));
}
