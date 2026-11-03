import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { sendEmailMessage } from "@/server/lib/email";

async function requireSession(request: NextRequest) {
  const resolved = await resolveRequestSession(request);
  if (!resolved.session) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Authentication required.", requiresAuth: true }, { status: 401 }),
    };
  }
  return { ok: true as const, session: resolved.session };
}

export async function POST(request: NextRequest) {
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

  const channels = Array.isArray(body.channels)
    ? body.channels.filter((v): v is string => typeof v === "string")
    : [];

  const sentTo: string[] = [];

  if (channels.includes("email")) {
    await sendEmailMessage({
      to: auth.session.email,
      subject: "Test notification",
      html: "<p>This is a test notification from your settings page.</p>",
      text: "This is a test notification from your settings page.",
    });
    sentTo.push("email");
  }

  if (channels.includes("push")) {
    sentTo.push("push");
  }

  return NextResponse.json({
    success: true,
    message: "Test notification sent",
    data: {
      sent_to: sentTo,
      email_preview: null,
      delivery_time: new Date().toISOString(),
    },
  });
}
