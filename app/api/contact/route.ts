import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { sendEmailMessage } from "@/server/lib/email";
import { validateLandingContactInput } from "@/server/lib/validators";

const COMPANY_INQUIRY_EMAIL =
  process.env.COMPANY_INQUIRY_EMAIL ||
  process.env.ORDERS_NOTIFY_EMAIL ||
  process.env.EMAIL_FROM_ADDRESS ||
  "shop.ontap58@gmail.com";

const MAX_BODY_BYTES = 16_384;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * POST /api/contact
 * Public landing-page contact form. Emails COMPANY_INQUIRY_EMAIL.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("inquiry-submit", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many messages. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)),
        },
      },
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request payload is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const validation = validateLandingContactInput(body as Record<string, unknown>);

  // Honeypot trip — pretend success so bots do not learn the trap.
  if (validation.isBot) {
    return NextResponse.json({
      success: true,
      message: "Your message has been sent. We'll get back to you soon.",
    });
  }

  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.errors[0] ?? "Invalid contact form.", details: validation.errors },
      { status: 400 },
    );
  }

  const { fullName, email, contactNumber, message, topic, newsletter } = validation.data;
  const safeName = escapeHtml(fullName);
  const safeEmail = escapeHtml(email);
  const safePhone = escapeHtml(contactNumber);
  const safeTopic = escapeHtml(topic);
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br/>");

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Website Contact Message</title></head>
<body style="font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:20px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
    <h2 style="margin:0 0 8px;color:#2A4792;">New Website Contact Message</h2>
    <p style="color:#6c757d;margin-bottom:24px;">Submitted via the OnTap landing page contact form</p>

    <div style="background:#f8f9fa;padding:16px;border-radius:8px;margin-bottom:24px;">
      <h3 style="margin:0 0 12px;font-size:16px;">Sender Details</h3>
      <p style="margin:4px 0;"><strong>Name:</strong> ${safeName}</p>
      <p style="margin:4px 0;"><strong>Email:</strong> ${safeEmail}</p>
      <p style="margin:4px 0;"><strong>Phone:</strong> ${safePhone}</p>
      <p style="margin:4px 0;"><strong>Topic:</strong> ${safeTopic}</p>
      <p style="margin:4px 0;"><strong>Newsletter opt-in:</strong> ${newsletter ? "Yes" : "No"}</p>
    </div>

    <div style="padding:16px;border:1px solid #e9ecef;border-radius:8px;">
      <h3 style="margin:0 0 12px;font-size:16px;">Message</h3>
      <p style="margin:0;line-height:1.5;white-space:pre-wrap;">${safeMessage}</p>
    </div>

    <p style="margin-top:32px;font-size:12px;color:#adb5bd;">
      Reply directly to this email to respond to the sender. IP: ${escapeHtml(ip || "unknown")}
    </p>
  </div>
</body>
</html>
  `.trim();

  const text = `
New Website Contact Message
---------------------------
Name: ${fullName}
Email: ${email}
Phone: ${contactNumber}
Topic: ${topic}
Newsletter opt-in: ${newsletter ? "Yes" : "No"}

Message:
${message}
  `.trim();

  try {
    await sendEmailMessage({
      to: COMPANY_INQUIRY_EMAIL,
      subject: `[${topic}] Contact from ${fullName}`,
      html,
      text,
      replyTo: email,
    });

    return NextResponse.json({
      success: true,
      message: "Your message has been sent. We'll get back to you soon.",
    });
  } catch (error) {
    console.error("[contact] email send failed:", error);
    return NextResponse.json(
      {
        error:
          "Failed to send your message. Please try again later or email us directly.",
      },
      { status: 500 },
    );
  }
}
