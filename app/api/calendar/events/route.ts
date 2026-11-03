import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp } from "@/server/lib/auth";
import { requireConnectionsSession } from "@/server/lib/connections";
import { requireCalendarPremiumAccess } from "@/lib/calendar/calendar-premium-guard";
import {
  createCalendarEvent,
  listCalendarEvents,
  parsePublicity,
} from "@/lib/services/calendar-event.service";

function parseDate(value: string | null, label: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("calendar-events-list", ip);
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

  const q = request.nextUrl.searchParams;
  const start = parseDate(q.get("start"), "start");
  const end = parseDate(q.get("end"), "end");
  if (!start || !end) {
    return NextResponse.json(
      { success: false, error: "start and end query parameters are required." },
      { status: 400 },
    );
  }

  try {
    const events = await listCalendarEvents(BigInt(auth.session.userId), start, end);
    return NextResponse.json({ success: true, data: { events } });
  } catch (error) {
    console.error("[calendar/events GET]", error);
    const message =
      error instanceof Error ? error.message : "Failed to load calendar events.";
    return NextResponse.json(
      {
        success: false,
        error:
          process.env.NODE_ENV === "development"
            ? message
            : "Failed to load calendar events.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("calendar-events-create", ip);
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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 255) {
    return NextResponse.json(
      { success: false, error: "Title is required (max 255 characters)." },
      { status: 400 },
    );
  }

  const startsAt = parseDate(
    typeof body.startsAt === "string" ? body.startsAt : null,
    "startsAt",
  );
  if (!startsAt) {
    return NextResponse.json(
      { success: false, error: "A valid start date and time is required." },
      { status: 400 },
    );
  }

  const endsAt =
    typeof body.endsAt === "string" && body.endsAt.trim()
      ? parseDate(body.endsAt, "endsAt")
      : null;
  if (typeof body.endsAt === "string" && body.endsAt.trim() && !endsAt) {
    return NextResponse.json(
      { success: false, error: "End date and time is invalid." },
      { status: 400 },
    );
  }
  if (endsAt && endsAt < startsAt) {
    return NextResponse.json(
      { success: false, error: "End time must be after the start time." },
      { status: 400 },
    );
  }

  const publicity = parsePublicity(body.publicity) ?? "private";
  const inviteeUserIds = Array.isArray(body.inviteeUserIds)
    ? body.inviteeUserIds.filter((id): id is string => typeof id === "string")
    : [];

  try {
    const event = await createCalendarEvent(BigInt(auth.session.userId), {
      title,
      description: typeof body.description === "string" ? body.description.trim() : null,
      place: typeof body.place === "string" ? body.place.trim() : null,
      startsAt,
      endsAt,
      publicity,
      inviteeUserIds,
    });
    return NextResponse.json({ success: true, data: { event } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create event.";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
