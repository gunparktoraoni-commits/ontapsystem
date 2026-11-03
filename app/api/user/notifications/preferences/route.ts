import { NextRequest, NextResponse } from "next/server";
import { getClientIp, resolveRequestSession, resolveEffectiveUserId } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  getDefaultPreferences,
  getOrCreateNotificationPreference,
  clearNotificationCachePrefix,
} from "@/server/lib/notifications";

function serialize(obj: unknown): unknown {
  return JSON.parse(JSON.stringify(obj, (_, value) => (typeof value === "bigint" ? value.toString() : value)));
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function toJsonString(value: Record<string, unknown> | null | undefined): string | null {
  if (value == null) return null;
  return JSON.stringify(value);
}

function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function isValidTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

async function requireSession(request: NextRequest) {
  const resolved = await resolveRequestSession(request);
  if (!resolved.session) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Authentication required.", requiresAuth: true }, { status: 401 }),
    };
  }
  return {
    ok: true as const,
    session: resolved.session,
    refreshed: resolved.refreshed,
    impersonation: resolved.impersonation,
    companyActing: resolved.companyActing,
    requiresReverification: resolved.requiresReverification,
  };
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = checkRateLimit("general", ip);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429 });
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const effectiveUserId = resolveEffectiveUserId(auth);
  const userId = BigInt(effectiveUserId);
  const pref = await getOrCreateNotificationPreference(userId);
  const user = await (await import("@/server/lib/prisma")).prisma.user.findUnique({
    where: { user_id: userId },
    select: { user_id: true, email: true },
  });

  const preferences = parseJsonObject(pref.preferences) ?? getDefaultPreferences();
  const quiet = parseJsonObject(pref.quiet_hours) ?? {
    enabled: false,
    start: "22:00",
    end: "08:00",
  };

  return NextResponse.json(
    serialize({
      success: true,
      data: {
        user_id: user?.user_id,
        email: user?.email ?? auth.session.email,
        email_verified: pref.email_verified,
        digest_schedule: pref.digest_schedule,
        digest_time: pref.digest_time,
        timezone: pref.timezone,
        quiet_hours: quiet,
        preferences,
        unsubscribed_at: pref.unsubscribed_at,
        email_notifications_enabled: pref.unsubscribed_at === null,
        email_frequency: {
          max_per_day: 10,
          remaining_today: Math.max(0, 10 - pref.emails_sent_today),
          reset_time: pref.email_frequency_reset,
        },
      },
    })
  );
}

export async function PUT(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = checkRateLimit("general", ip);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429 });
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const digestSchedule = typeof body.digest_schedule === "string" ? body.digest_schedule : undefined;
  const digestTime = typeof body.digest_time === "string" ? body.digest_time : undefined;
  const timezone = typeof body.timezone === "string" ? body.timezone : undefined;
  const quietHours = (body.quiet_hours ?? undefined) as Record<string, unknown> | undefined;
  const partialPrefs = (body.preferences ?? undefined) as Record<string, unknown> | undefined;
  const emailNotificationsEnabled =
    typeof body.email_notifications_enabled === "boolean"
      ? body.email_notifications_enabled
      : undefined;

  if (digestSchedule && !["daily", "weekly", "never"].includes(digestSchedule)) {
    return NextResponse.json({ success: false, error: "Invalid digest_schedule." }, { status: 422 });
  }

  if (digestTime && !isValidTime(digestTime)) {
    return NextResponse.json({ success: false, error: "Invalid digest_time. Use HH:MM." }, { status: 422 });
  }

  if (timezone && !isValidTimezone(timezone)) {
    return NextResponse.json({ success: false, error: "Invalid timezone." }, { status: 422 });
  }

  if (quietHours) {
    const start = typeof quietHours.start === "string" ? quietHours.start : "";
    const end = typeof quietHours.end === "string" ? quietHours.end : "";
    if (start && !isValidTime(start)) {
      return NextResponse.json({ success: false, error: "Invalid quiet_hours.start." }, { status: 422 });
    }
    if (end && !isValidTime(end)) {
      return NextResponse.json({ success: false, error: "Invalid quiet_hours.end." }, { status: 422 });
    }
  }

  const effectiveUserId = resolveEffectiveUserId(auth);
  const userId = BigInt(effectiveUserId);
  const pref = await getOrCreateNotificationPreference(userId);
  const currentPrefs = parseJsonObject(pref.preferences) ?? getDefaultPreferences();

  const mergedPrefs = { ...currentPrefs };
  const updatedFields: string[] = [];

  if (partialPrefs && typeof partialPrefs === "object") {
    for (const [eventKey, patchValue] of Object.entries(partialPrefs)) {
      const current = (currentPrefs[eventKey] as Record<string, unknown> | undefined) ?? {
        in_app: true,
        email: false,
        digest: false,
        push: false,
        priority: "medium",
      };

      if (!patchValue || typeof patchValue !== "object") continue;
      const patch = patchValue as Record<string, unknown>;
      const next = {
        ...current,
        ...patch,
      };

      mergedPrefs[eventKey] = next;
      updatedFields.push(eventKey);
    }
  }

  const unsubscribedAt =
    emailNotificationsEnabled === undefined
      ? pref.unsubscribed_at
      : emailNotificationsEnabled
        ? null
        : new Date();

  if (emailNotificationsEnabled !== undefined) {
    updatedFields.push("email_notifications_enabled");
  }

  await (await import("@/server/lib/prisma")).prisma.notificationPreference.upsert({
    where: { user_id: userId },
    create: {
      id: `npref_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      user_id: userId,
      digest_schedule: digestSchedule ?? pref.digest_schedule,
      digest_time: digestTime ?? pref.digest_time,
      timezone: timezone ?? pref.timezone,
      quiet_hours: quietHours !== undefined ? toJsonString(quietHours) : pref.quiet_hours,
      preferences: JSON.stringify(mergedPrefs),
      email_verified: pref.email_verified,
      emails_sent_today: pref.emails_sent_today,
      email_frequency_reset: pref.email_frequency_reset,
      unsubscribed_at: unsubscribedAt,
    },
    update: {
      ...(digestSchedule ? { digest_schedule: digestSchedule } : {}),
      ...(digestTime ? { digest_time: digestTime } : {}),
      ...(timezone ? { timezone } : {}),
      ...(quietHours ? { quiet_hours: JSON.stringify(quietHours) } : {}),
      ...(emailNotificationsEnabled !== undefined ? { unsubscribed_at: unsubscribedAt } : {}),
      preferences: JSON.stringify(mergedPrefs),
      updated_at: new Date(),
    },
  });

  if (digestSchedule) updatedFields.push("digest_schedule");
  if (digestTime) updatedFields.push("digest_time");
  if (timezone) updatedFields.push("timezone");
  if (quietHours) updatedFields.push("quiet_hours");

  clearNotificationCachePrefix(`notifications:${effectiveUserId}:`);

  return NextResponse.json({
    success: true,
    message: "Notification preferences updated",
    data: {
      updated_fields: Array.from(new Set(updatedFields)),
      email_notifications_enabled: unsubscribedAt === null,
      unsubscribed_at: unsubscribedAt,
      preview_url: "/api/user/notifications/test",
    },
  });
}
