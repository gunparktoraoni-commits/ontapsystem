import { prisma } from "@/server/lib/prisma";
import { validateFutureSchedule } from "@/lib/calendar/calendar-utils";
import { getAcceptedAssociateIds } from "@/lib/services/calendar-connections";
import {
  getUserCompanyId,
  isCompanyCalendarAdmin,
  usersShareCompany,
} from "@/lib/services/calendar-company";
import {
  notifyCalendarAttendance,
  notifyCalendarEventCreated,
} from "@/lib/services/calendar-notification.service";

export type CalendarPublicity = "private" | "public" | "custom" | "company";

export type CalendarEventInput = {
  title: string;
  description?: string | null;
  place?: string | null;
  company?: string | null;
  startsAt: Date;
  endsAt?: Date | null;
  publicity: CalendarPublicity;
  inviteeUserIds?: string[];
};

const PUBLICITY_VALUES = new Set<CalendarPublicity>(["private", "public", "custom", "company"]);

export function parsePublicity(value: unknown): CalendarPublicity | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase() as CalendarPublicity;
  return PUBLICITY_VALUES.has(normalized) ? normalized : null;
}

function formatEvent(
  event: {
    event_id: bigint;
    user_id: bigint;
    title: string;
    description: string | null;
    place: string | null;
    company: string | null;
    starts_at: Date;
    ends_at: Date | null;
    publicity: string;
    created_at: Date;
    updated_at: Date | null;
    user: { user_id: bigint; first_name: string; last_name: string };
    invites: { user_id: bigint; user: { user_id: bigint; first_name: string; last_name: string } }[];
    attendees: {
      user_id: bigint;
      status: string;
      created_at: Date;
      user: { user_id: bigint; first_name: string; last_name: string };
    }[];
  },
  viewerId: bigint,
) {
  const isOwner = event.user_id === viewerId;
  const goingAttendees = event.attendees.filter((row) => row.status === "going");
  const viewerIsGoing = goingAttendees.some((row) => row.user_id === viewerId);

  return {
    id: event.event_id.toString(),
    ownerId: event.user_id.toString(),
    ownerName: `${event.user.first_name} ${event.user.last_name}`.trim(),
    title: event.title,
    description: event.description,
    place: event.place,
    company: event.company,
    startsAt: event.starts_at.toISOString(),
    endsAt: event.ends_at?.toISOString() ?? null,
    publicity: event.publicity as CalendarPublicity,
    isOwner,
    viewerIsGoing,
    goingCount: goingAttendees.length,
    invitees: event.invites.map((inv) => ({
      id: inv.user_id.toString(),
      name: `${inv.user.first_name} ${inv.user.last_name}`.trim(),
    })),
    attendees: goingAttendees.map((row) => ({
      id: row.user_id.toString(),
      name: `${row.user.first_name} ${row.user.last_name}`.trim(),
      goingAt: row.created_at.toISOString(),
    })),
    createdAt: event.created_at.toISOString(),
    updatedAt: event.updated_at?.toISOString() ?? null,
  };
}

const eventInclude = {
  user: { select: { user_id: true, first_name: true, last_name: true } },
  invites: {
    select: {
      user_id: true,
      user: { select: { user_id: true, first_name: true, last_name: true } },
    },
  },
  attendees: {
    select: {
      user_id: true,
      status: true,
      created_at: true,
      user: { select: { user_id: true, first_name: true, last_name: true } },
    },
  },
} as const;

export async function listCalendarEvents(
  userId: bigint,
  rangeStart: Date,
  rangeEnd: Date,
) {
  const associateIds = await getAcceptedAssociateIds(userId);
  const viewerCompanyId = await getUserCompanyId(userId);

  const events = await prisma.calendarEvent.findMany({
    where: {
      starts_at: { gte: rangeStart, lte: rangeEnd },
      OR: [
        { user_id: userId },
        {
          publicity: "public",
          user_id: { in: associateIds.length > 0 ? associateIds : [BigInt(-1)] },
        },
        {
          publicity: "custom",
          invites: { some: { user_id: userId } },
        },
        ...(viewerCompanyId
          ? [
              {
                publicity: "company",
                user: { company_id: viewerCompanyId },
              },
            ]
          : []),
        {
          attendees: { some: { user_id: userId, status: "going" } },
        },
      ],
    },
    include: eventInclude,
    orderBy: { starts_at: "asc" },
  });

  return events.map((event) => formatEvent(event, userId));
}

export async function getCalendarEvent(eventId: bigint, userId: bigint) {
  const event = await prisma.calendarEvent.findUnique({
    where: { event_id: eventId },
    include: eventInclude,
  });
  if (!event) return null;

  const canView = await canUserViewEvent(userId, event);
  if (!canView) return null;

  return formatEvent(event, userId);
}

async function canUserViewEvent(
  userId: bigint,
  event: { user_id: bigint; publicity: string; event_id: bigint },
): Promise<boolean> {
  if (event.user_id === userId) return true;

  const attending = await prisma.calendarEventAttendance.findFirst({
    where: { event_id: event.event_id, user_id: userId, status: "going" },
  });
  if (attending) return true;

  if (event.publicity === "private") return false;
  if (event.publicity === "public") {
    const associateIds = await getAcceptedAssociateIds(userId);
    return associateIds.some((id) => id === event.user_id);
  }
  if (event.publicity === "custom") {
    const invite = await prisma.calendarEventInvite.findUnique({
      where: { event_id_user_id: { event_id: event.event_id, user_id: userId } },
    });
    return Boolean(invite);
  }
  if (event.publicity === "company") {
    return usersShareCompany(userId, event.user_id);
  }
  return false;
}

async function validateInvitees(
  ownerId: bigint,
  publicity: CalendarPublicity,
  inviteeUserIds: string[] | undefined,
): Promise<bigint[]> {
  if (publicity !== "custom") return [];
  const ids = (inviteeUserIds ?? [])
    .map((id) => {
      try {
        return BigInt(id);
      } catch {
        return null;
      }
    })
    .filter((id): id is bigint => id !== null);

  if (ids.length === 0) {
    throw new Error("Choose at least one associate for a custom event.");
  }

  const associateIds = await getAcceptedAssociateIds(ownerId);
  const associateSet = new Set(associateIds.map((id) => id.toString()));
  const invalid = ids.filter((id) => !associateSet.has(id.toString()));
  if (invalid.length > 0) {
    throw new Error("One or more selected associates are not in your network.");
  }

  return ids;
}

async function assertPublicityAllowed(userId: bigint, publicity: CalendarPublicity): Promise<void> {
  if (publicity !== "company") return;
  const allowed = await isCompanyCalendarAdmin(userId);
  if (!allowed) {
    throw new Error("Only company admins can share appointments with the company.");
  }
}

export async function createCalendarEvent(userId: bigint, input: CalendarEventInput) {
  validateFutureSchedule(input.startsAt, input.endsAt ?? null);
  await assertPublicityAllowed(userId, input.publicity);

  const inviteeIds = await validateInvitees(userId, input.publicity, input.inviteeUserIds);

  const event = await prisma.calendarEvent.create({
    data: {
      user_id: userId,
      title: input.title,
      description: input.description ?? null,
      place: input.place ?? null,
      company: null,
      starts_at: input.startsAt,
      ends_at: input.endsAt ?? null,
      publicity: input.publicity,
      invites:
        inviteeIds.length > 0
          ? { create: inviteeIds.map((id) => ({ user_id: id })) }
          : undefined,
    },
    include: eventInclude,
  });

  void notifyCalendarEventCreated(event.event_id);

  return formatEvent(event, userId);
}

export async function updateCalendarEvent(
  eventId: bigint,
  userId: bigint,
  input: Partial<CalendarEventInput>,
) {
  const existing = await prisma.calendarEvent.findUnique({ where: { event_id: eventId } });
  if (!existing || existing.user_id !== userId) {
    throw new Error("Event not found or you do not have permission to edit it.");
  }

  const startsAt = input.startsAt ?? existing.starts_at;
  const endsAt = input.endsAt !== undefined ? input.endsAt : existing.ends_at;
  validateFutureSchedule(startsAt, endsAt);

  const publicity = input.publicity ?? (existing.publicity as CalendarPublicity);
  await assertPublicityAllowed(userId, publicity);

  let inviteeIds: bigint[] = [];
  if (publicity === "custom") {
    if (input.inviteeUserIds !== undefined) {
      inviteeIds = await validateInvitees(userId, publicity, input.inviteeUserIds);
    } else {
      const existingInvites = await prisma.calendarEventInvite.findMany({
        where: { event_id: eventId },
        select: { user_id: true },
      });
      inviteeIds = existingInvites.map((row) => row.user_id);
      if (inviteeIds.length === 0) {
        throw new Error("Choose at least one associate for a custom event.");
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.calendarEvent.update({
      where: { event_id: eventId },
      data: {
        title: input.title ?? existing.title,
        description: input.description !== undefined ? input.description : existing.description,
        place: input.place !== undefined ? input.place : existing.place,
        starts_at: startsAt,
        ends_at: endsAt,
        publicity,
        updated_at: new Date(),
      },
    });

    if (input.publicity !== undefined || input.inviteeUserIds !== undefined) {
      await tx.calendarEventInvite.deleteMany({ where: { event_id: eventId } });
      if (publicity === "custom" && inviteeIds.length > 0) {
        await tx.calendarEventInvite.createMany({
          data: inviteeIds.map((id) => ({ event_id: eventId, user_id: id })),
        });
      }
    }
  });

  const updated = await prisma.calendarEvent.findUnique({
    where: { event_id: eventId },
    include: eventInclude,
  });
  if (!updated) throw new Error("Failed to load updated event.");
  return formatEvent(updated, userId);
}

export async function deleteCalendarEvent(eventId: bigint, userId: bigint) {
  const existing = await prisma.calendarEvent.findUnique({ where: { event_id: eventId } });
  if (!existing || existing.user_id !== userId) {
    throw new Error("Event not found or you do not have permission to delete it.");
  }
  await prisma.calendarEvent.delete({ where: { event_id: eventId } });
}

export async function attendCalendarEvent(eventId: bigint, userId: bigint) {
  const event = await prisma.calendarEvent.findUnique({
    where: { event_id: eventId },
    include: eventInclude,
  });
  if (!event) {
    throw new Error("Event not found.");
  }
  if (event.user_id === userId) {
    throw new Error("You already own this event on your calendar.");
  }

  const canView = await canUserViewEvent(userId, event);
  if (!canView) {
    throw new Error("You do not have access to this event.");
  }

  if (event.starts_at.getTime() < Date.now()) {
    throw new Error("This appointment has already passed.");
  }

  const existing = await prisma.calendarEventAttendance.findUnique({
    where: { event_id_user_id: { event_id: eventId, user_id: userId } },
  });

  if (existing?.status === "going") {
    const refreshed = await prisma.calendarEvent.findUnique({
      where: { event_id: eventId },
      include: eventInclude,
    });
    if (!refreshed) throw new Error("Event not found.");
    return formatEvent(refreshed, userId);
  }

  await prisma.calendarEventAttendance.upsert({
    where: { event_id_user_id: { event_id: eventId, user_id: userId } },
    create: { event_id: eventId, user_id: userId, status: "going" },
    update: { status: "going", updated_at: new Date() },
  });

  void notifyCalendarAttendance(eventId, userId);

  const refreshed = await prisma.calendarEvent.findUnique({
    where: { event_id: eventId },
    include: eventInclude,
  });
  if (!refreshed) throw new Error("Event not found.");
  return formatEvent(refreshed, userId);
}
