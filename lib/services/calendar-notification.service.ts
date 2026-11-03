import { prisma } from "@/server/lib/prisma";
import { sendEmailMessage } from "@/server/lib/email";
import { createNotificationFromEvent } from "@/server/lib/notifications";
import {
  buildCalendarEventEmailHtml,
  buildCalendarEventEmailText,
} from "@/lib/calendar/calendar-email";
import {
  buildCalendarEventUrl,
} from "@/lib/calendar/calendar-utils";
import { getAcceptedAssociateIds } from "@/lib/services/calendar-connections";
import { getCompanyNotificationRecipientIds } from "@/lib/services/calendar-company";
import type { CalendarPublicity } from "@/lib/services/calendar-event.service";

type CalendarEventRecord = {
  event_id: bigint;
  user_id: bigint;
  title: string;
  description: string | null;
  place: string | null;
  starts_at: Date;
  ends_at: Date | null;
  publicity: string;
  user: { first_name: string; last_name: string };
  invites: { user_id: bigint }[];
};

function ownerName(event: CalendarEventRecord): string {
  return `${event.user.first_name} ${event.user.last_name}`.trim();
}

async function resolveRecipientIds(
  ownerId: bigint,
  publicity: CalendarPublicity,
  inviteeIds: bigint[],
): Promise<bigint[]> {
  if (publicity === "private") return [];
  if (publicity === "custom") return inviteeIds;
  if (publicity === "company") return getCompanyNotificationRecipientIds(ownerId);
  return getAcceptedAssociateIds(ownerId);
}

async function sendCalendarEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<void> {
  if (!to.trim()) return;
  await sendEmailMessage({ to, subject, html, text });
}

function resolveAppBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.FRONTEND_URL?.trim() ||
    "https://portal.ontap.ph"
  ).replace(/\/+$/, "");
}

export async function notifyCalendarEventCreated(eventId: bigint): Promise<void> {
  const event = await prisma.calendarEvent.findUnique({
    where: { event_id: eventId },
    include: {
      user: { select: { first_name: true, last_name: true } },
      invites: { select: { user_id: true } },
    },
  });
  if (!event) return;

  const publicity = event.publicity as CalendarPublicity;
  if (publicity === "private") return;

  const inviteeIds = event.invites.map((row) => row.user_id);
  const recipientIds = await resolveRecipientIds(event.user_id, publicity, inviteeIds);
  if (recipientIds.length === 0) return;

  const recipients = await prisma.user.findMany({
    where: { user_id: { in: recipientIds }, is_active: true },
    select: { user_id: true, email: true, first_name: true, role: true },
  });

  const appBase = resolveAppBaseUrl();
  const hostName = ownerName(event);
  const emailEvent = {
    title: event.title,
    description: event.description,
    place: event.place,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    ownerName: hostName,
  };

  await Promise.allSettled(
    recipients.map(async (recipient) => {
      const eventUrl = `${appBase}${buildCalendarEventUrl(recipient.role, event.event_id.toString())}`;

      await createNotificationFromEvent({
        targetUserId: recipient.user_id,
        triggerUserId: event.user_id,
        eventType: "calendar_event_shared",
        priority: "high",
        needsEmail: false,
        metadata: {
          event_id: event.event_id.toString(),
          event_title: event.title,
          owner_name: hostName,
          starts_at: event.starts_at.toISOString(),
          action_url: buildCalendarEventUrl(recipient.role, event.event_id.toString()),
        },
      });

      if (!recipient.email?.trim()) return;

      const intro =
        publicity === "company"
          ? `${hostName} scheduled a company appointment and shared it with your team.`
          : `${hostName} scheduled an appointment and shared it with you.`;
      const subject = `New appointment: ${event.title}`;
      const html = buildCalendarEventEmailHtml({
        heading: "You're invited to an appointment",
        intro,
        event: emailEvent,
        eventUrl,
      });
      const text = buildCalendarEventEmailText({ intro, event: emailEvent, eventUrl });

      await sendCalendarEmail(recipient.email, subject, html, text);
    }),
  );

  await prisma.calendarEvent.update({
    where: { event_id: eventId },
    data: { creation_notified_at: new Date() },
  });
}

export async function notifyCalendarAttendance(
  eventId: bigint,
  attendeeUserId: bigint,
): Promise<void> {
  const event = await prisma.calendarEvent.findUnique({
    where: { event_id: eventId },
    include: {
      user: { select: { user_id: true, role: true } },
      attendees: {
        where: { user_id: attendeeUserId, status: "going" },
        include: {
          user: { select: { first_name: true, last_name: true } },
        },
      },
    },
  });
  if (!event || event.attendees.length === 0) return;

  const attendee = event.attendees[0];
  const attendeeName = `${attendee.user.first_name} ${attendee.user.last_name}`.trim();

  await createNotificationFromEvent({
    targetUserId: event.user_id,
    triggerUserId: attendeeUserId,
    eventType: "calendar_event_attendance",
    priority: "medium",
    needsEmail: false,
    metadata: {
      event_id: event.event_id.toString(),
      event_title: event.title,
      attendee_name: attendeeName,
      action_url: buildCalendarEventUrl(event.user.role, event.event_id.toString()),
    },
  });
}

export async function sendCalendarReminderEmails(kind: "upcoming" | "day_of"): Promise<{
  processed: number;
  emailed: number;
}> {
  const now = new Date();
  const where =
    kind === "upcoming"
      ? {
          starts_at: { gt: now, lte: new Date(now.getTime() + 2 * 60 * 60 * 1000) },
          upcoming_reminder_sent_at: null,
          publicity: { in: ["public", "custom", "company"] },
        }
      : {
          starts_at: {
            gte: startOfLocalDay(now),
            lt: endOfLocalDay(now),
          },
          day_reminder_sent_at: null,
          publicity: { in: ["public", "custom", "company"] },
        };

  const events = await prisma.calendarEvent.findMany({
    where,
    include: {
      user: { select: { user_id: true, first_name: true, last_name: true, email: true, role: true } },
      invites: { select: { user_id: true } },
      attendees: { select: { user_id: true } },
    },
  });

  const appBase = resolveAppBaseUrl();
  let emailed = 0;

  for (const event of events) {
    const publicity = event.publicity as CalendarPublicity;
    const inviteeIds = event.invites.map((row) => row.user_id);
    const associateIds = await resolveRecipientIds(event.user_id, publicity, inviteeIds);
    const attendeeIds = event.attendees.map((row) => row.user_id);
    const recipientIdSet = new Set<bigint>([...associateIds, ...attendeeIds, event.user_id]);

    const recipients = await prisma.user.findMany({
      where: { user_id: { in: [...recipientIdSet] }, is_active: true },
      select: { user_id: true, email: true, role: true },
    });

    const heading =
      kind === "upcoming" ? "Appointment starting soon" : "Appointment is today";
    const intro =
      kind === "upcoming"
        ? `Reminder: "${event.title}" starts in less than 2 hours.`
        : `Reminder: "${event.title}" is scheduled for today.`;
    const hostName = `${event.user.first_name} ${event.user.last_name}`.trim();
    const emailEvent = {
      title: event.title,
      description: event.description,
      place: event.place,
      starts_at: event.starts_at,
      ends_at: event.ends_at,
      ownerName: hostName,
    };

    await Promise.allSettled(
      recipients.map(async (recipient) => {
        if (!recipient.email) return;
        const eventUrl = `${appBase}${buildCalendarEventUrl(recipient.role, event.event_id.toString())}`;
        const html = buildCalendarEventEmailHtml({
          heading,
          intro,
          event: emailEvent,
          eventUrl,
          ctaLabel: "Open calendar",
        });
        const text = buildCalendarEventEmailText({ intro, event: emailEvent, eventUrl });
        await sendCalendarEmail(
          recipient.email,
          kind === "upcoming" ? `Starting soon: ${event.title}` : `Today: ${event.title}`,
          html,
          text,
        );
        emailed += 1;

        await createNotificationFromEvent({
          targetUserId: recipient.user_id,
          triggerUserId: event.user_id,
          eventType: "calendar_event_reminder",
          priority: "high",
          needsEmail: false,
          metadata: {
            event_id: event.event_id.toString(),
            event_title: event.title,
            reminder_kind: kind,
            action_url: buildCalendarEventUrl(recipient.role, event.event_id.toString()),
          },
        });
      }),
    );

    await prisma.calendarEvent.update({
      where: { event_id: event.event_id },
      data:
        kind === "upcoming"
          ? { upcoming_reminder_sent_at: new Date() }
          : { day_reminder_sent_at: new Date() },
    });
  }

  return { processed: events.length, emailed };
}

function startOfLocalDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfLocalDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}
