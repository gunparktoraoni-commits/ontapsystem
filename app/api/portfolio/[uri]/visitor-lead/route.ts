import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { logActivity } from "@/server/lib/activity";
import { createNotificationFromEvent } from "@/server/lib/notifications";
import { createPortfolioLead } from "@/lib/services/portfolio-lead.service";

const CUSTOM_URI_REGEX = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]{2,64}$/;
/** Matches AliasPageClient ids: UUID, hex, or `visitor_<ts>_<rand>`. */
const VISITOR_ID_REGEX = /^[a-z0-9][a-z0-9_-]{7,63}$/i;

function sanitize(value: unknown, max = 255): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 191;
}

function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 && phone.length <= 50;
}

function normalizeVisitorId(raw: string): string | null {
  const id = raw.trim();
  if (!id) return null;
  if (!VISITOR_ID_REGEX.test(id)) return null;
  return id.slice(0, 64);
}

/**
 * Guest lead capture for portfolio visitors without an active session.
 * Enforces one lead per email (and visitor id) per portfolio.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ uri: string }> },
) {
  const ip = getClientIp(request);

  try {
    const rateCheck = checkRateLimit("visitor-lead-submit", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many submissions. Please wait a moment and try again." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        },
      );
    }

    // Logged-in visitors must use Connect / Inquiry — not the guest lead form.
    const sessionToken = request.cookies.get("session_token")?.value;
    if (sessionToken) {
      try {
        const session = await validateToken(sessionToken);
        if (session) {
          return NextResponse.json(
            {
              error:
                "You're signed in. Use Connect or the inquiry form instead of the guest contact prompt.",
              code: "authenticated",
            },
            { status: 403 },
          );
        }
      } catch {
        // treat as guest
      }
    }

    const { uri } = await params;
    if (!uri || !CUSTOM_URI_REGEX.test(uri)) {
      return NextResponse.json({ error: "Portfolio not found." }, { status: 404 });
    }

    const rawBody = await request.text();
    if (rawBody.length > 8 * 1024) {
      return NextResponse.json({ error: "Request body too large." }, { status: 413 });
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const name = sanitize(body.name, 255);
    const email = sanitize(body.email, 191).toLowerCase();
    const phone = sanitize(body.phone, 50);
    const visitorId = normalizeVisitorId(sanitize(body.visitorId, 64));

    const errors: string[] = [];
    if (!name || name.length < 2) errors.push("Please enter your full name.");
    if (!isValidEmail(email)) errors.push("Please enter a valid email address.");
    if (!isValidPhone(phone)) errors.push("Please enter a valid contact number.");
    if (errors.length) {
      return NextResponse.json({ error: errors[0], errors }, { status: 422 });
    }

    const owner = await prisma.bizcard.findFirst({
      where: {
        url_alias: uri,
        deactivated_flag: false,
        user: { is: { is_active: true } },
      },
      select: {
        user_id: true,
        bizcard_id: true,
        user: { select: { first_name: true, last_name: true, email: true } },
      },
    });
    if (!owner?.user_id || !owner.bizcard_id || !owner.user) {
      return NextResponse.json({ error: "Portfolio not found." }, { status: 404 });
    }

    // Owners should not spam their own leads inbox via the guest form (incognito/logged-out).
    const ownerEmail = (owner.user.email ?? "").trim().toLowerCase();
    if (ownerEmail && ownerEmail === email) {
      return NextResponse.json(
        {
          error: "You can't leave a lead on your own portfolio.",
          code: "self_lead",
        },
        { status: 403 },
      );
    }

    const created = await createPortfolioLead({
      userId: owner.user_id,
      bizcardId: owner.bizcard_id,
      name,
      email,
      phone,
      visitorId,
    });

    if (!created.ok) {
      return NextResponse.json(
        {
          error:
            "You already shared your details on this portfolio. The owner can reach you with the info you provided.",
          code: "duplicate",
          alreadySubmitted: true,
        },
        { status: 409 },
      );
    }

    // Do not pass lead_id as reference_id — dashboard deep-links NEW_INQUIRY to /inquiry?id=.
    void logActivity(Number(owner.user_id), "NEW_INQUIRY", null, {
      senderName: name,
      source: "visitor_lead",
      leadId: created.lead.lead_id.toString(),
    }).catch(() => undefined);

    void createNotificationFromEvent({
      targetUserId: owner.user_id,
      triggerUserId: null,
      eventType: "inquiry_sent",
      priority: "high",
      metadata: {
        sender_name: name,
        title: "New portfolio lead",
        message: `${name} left contact details on your portfolio`,
        action_url: "/user/leads",
        action_text: "Open Leads",
        source: "visitor_lead",
        lead_id: created.lead.lead_id.toString(),
      },
      needsEmail: true,
      emailPriority: "immediate",
    }).catch(() => undefined);

    const ownerName =
      `${owner.user.first_name ?? ""} ${owner.user.last_name ?? ""}`.trim() || "the owner";

    return NextResponse.json(
      {
        leadId: created.lead.lead_id.toString(),
        message: `Thanks! ${ownerName} can now reach out to you.`,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("[portfolio/visitor-lead]", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
