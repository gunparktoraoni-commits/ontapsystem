import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp } from "@/server/lib/auth";
import { requireConnectionsSession } from "@/server/lib/connections";
import { requireCalendarPremiumAccess } from "@/lib/calendar/calendar-premium-guard";
import { attendCalendarEvent } from "@/lib/services/calendar-event.service";

type RouteContext = { params: Promise<{ eventId: string }> };

function parseEventId(raw: string): bigint | null {
  try {
    const id = BigInt(raw);
    return id > BigInt(0) ? id : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("calendar-events-attend", ip);
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

  try {
    const event = await attendCalendarEvent(eventId, BigInt(auth.session.userId));
    return NextResponse.json({ success: true, data: { event } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to join event.";
    const status = /not found|access|passed/i.test(message) ? 400 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
