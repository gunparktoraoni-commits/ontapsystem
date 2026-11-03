import { format, isBefore, startOfDay } from "date-fns";

export function resolveCalendarPortalPath(role: string): string {
  const normalized = role.trim().toLowerCase();
  if (normalized === "super_admin") return "/superadmin/calendar";
  if (normalized === "staff") return "/staff/calendar";
  if (normalized === "admin" || normalized === "company_admin" || normalized === "manager") {
    return "/admin/calendar";
  }
  return "/user/calendar";
}

export function buildCalendarEventUrl(role: string, eventId: string): string {
  return `${resolveCalendarPortalPath(role)}?event=${encodeURIComponent(eventId)}`;
}

export function isPastCalendarDay(day: Date, now = new Date()): boolean {
  return isBefore(startOfDay(day), startOfDay(now));
}

export function isToday(day: Date, now = new Date()): boolean {
  return format(day, "yyyy-MM-dd") === format(now, "yyyy-MM-dd");
}

export function minSelectableDate(now = new Date()): string {
  return format(now, "yyyy-MM-dd");
}

export function generateTimeOptions(stepMinutes = 15): string[] {
  const options: string[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += stepMinutes) {
      options.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    }
  }
  return options;
}

export function filterStartTimeOptions(
  date: string,
  options: string[],
  now = new Date(),
): string[] {
  if (date !== format(now, "yyyy-MM-dd")) return options;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return options.filter((time) => {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m >= currentMinutes;
  });
}

export function filterEndTimeOptions(
  date: string,
  startTime: string,
  options: string[],
  now = new Date(),
): string[] {
  const startOptions = filterStartTimeOptions(date, options, now);
  const [sh, sm] = startTime.split(":").map(Number);
  const startMinutes = sh * 60 + sm;
  return startOptions.filter((time) => {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m > startMinutes;
  });
}

export function formatTimeLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const date = new Date();
  date.setHours(h, m, 0, 0);
  return format(date, "h:mm a");
}

export function validateFutureSchedule(startsAt: Date, endsAt?: Date | null, now = new Date()): void {
  if (startsAt.getTime() < now.getTime()) {
    throw new Error("Appointments must be scheduled in the future. Pick a later date or time.");
  }
  if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new Error("End time must be after the start time.");
  }
}

export function formatEventDateTimeRange(startsAt: Date, endsAt?: Date | null): string {
  const startLabel = format(startsAt, "EEEE, MMM d, yyyy 'at' h:mm a");
  if (!endsAt) return startLabel;
  return `${startLabel} – ${format(endsAt, "h:mm a")}`;
}
