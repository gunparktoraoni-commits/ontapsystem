import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/server/lib/notification-cron";
import { sendCalendarReminderEmails } from "@/lib/services/calendar-notification.service";

export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const [upcoming, dayOf] = await Promise.all([
      sendCalendarReminderEmails("upcoming"),
      sendCalendarReminderEmails("day_of"),
    ]);

    return NextResponse.json({
      success: true,
      upcoming,
      dayOf,
    });
  } catch (error) {
    console.error("[api/cron/calendar-reminders GET]", error);
    return NextResponse.json(
      { success: false, error: "Failed to process calendar reminders." },
      { status: 500 },
    );
  }
}
