import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp } from "@/server/lib/auth";
import { requireConnectionsSession } from "@/server/lib/connections";
import { requireCalendarPremiumAccess } from "@/lib/calendar/calendar-premium-guard";
import {
  deleteCalendarEvent,
  getCalendarEvent,
  parsePublicity,
  updateCalendarEvent,
} from "@/lib/services/calendar-event.service";

type RouteContext = { params: Promise<{ eventId: string }> };

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseEventId(raw: string): bigint | null {
  try {
    const id = BigInt(raw);
    return id > BigInt(0) ? id : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireConnectionsSession(request);
  if (!auth.ok) return auth.response;

  const premium = await requireCalendarPremiumAccess(
    BigInt(auth.session.userId),
    auth.session.role,
  );
  if (!premium.ok) return premium.response;

  const { eventId: eventIdRaw } = await context.params;
  const eventId = parseEventId(eventIdRaw);
  if (!eventId) {
    return NextResponse.json({ success: false, error: "Invalid event id." }, { status: 400 });
  }

  const event = await getCalendarEvent(eventId, BigInt(auth.session.userId));
  if (!event) {
    return NextResponse.json({ success: false, error: "Event not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: { event } });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("calendar-events-update", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many requests. Please slow down." },
      { status: 429 },
    );
  }

  const auth = await requireConnectionsSession(request);
  if (!auth.ok) return auth.response;

  const premium = await requireCalendarPremiumAccess(
    BigInt(auth.session.userId),
    auth.session.role,
  );
  if (!premium.ok) return premium.response;

  const { eventId: eventIdRaw } = await context.params;
  const eventId = parseEventId(eventIdRaw);
  if (!eventId) {
    return NextResponse.json({ success: false, error: "Invalid event id." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const patch: Parameters<typeof updateCalendarEvent>[2] = {};
  if (typeof body.title === "string") {
    const title = body.title.trim();
    if (!title) {
      return NextResponse.json({ success: false, error: "Title cannot be empty." }, { status: 400 });
    }
    patch.title = title;
  }
  if (body.description !== undefined) {
    patch.description = typeof body.description === "string" ? body.description.trim() : null;
  }
  if (body.place !== undefined) {
    patch.place = typeof body.place === "string" ? body.place.trim() : null;
  }
  if (typeof body.startsAt === "string") {
    const startsAt = parseDate(body.startsAt);
    if (!startsAt) {
      return NextResponse.json(
        { success: false, error: "Invalid start date and time." },
        { status: 400 },
      );
    }
    patch.startsAt = startsAt;
  }
  if (body.endsAt !== undefined) {
    patch.endsAt =
      typeof body.endsAt === "string" && body.endsAt.trim() ? parseDate(body.endsAt) : null;
  }
  if (body.publicity !== undefined) {
    const publicity = parsePublicity(body.publicity);
    if (!publicity) {
      return NextResponse.json({ success: false, error: "Invalid publicity setting." }, { status: 400 });
    }
    patch.publicity = publicity;
  }
  if (body.inviteeUserIds !== undefined) {
    patch.inviteeUserIds = Array.isArray(body.inviteeUserIds)
      ? body.inviteeUserIds.filter((id): id is string => typeof id === "string")
      : [];
  }

  try {
    const event = await updateCalendarEvent(eventId, BigInt(auth.session.userId), patch);
    return NextResponse.json({ success: true, data: { event } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update event.";
    const status = /not found|permission/i.test(message) ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireConnectionsSession(request);
  if (!auth.ok) return auth.response;

  const premium = await requireCalendarPremiumAccess(
    BigInt(auth.session.userId),
    auth.session.role,
  );
  if (!premium.ok) return premium.response;

  const { eventId: eventIdRaw } = await context.params;
  const eventId = parseEventId(eventIdRaw);
  if (!eventId) {
    return NextResponse.json({ success: false, error: "Invalid event id." }, { status: 400 });
  }

  try {
    await deleteCalendarEvent(eventId, BigInt(auth.session.userId));
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete event.";
    const status = /not found|permission/i.test(message) ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
