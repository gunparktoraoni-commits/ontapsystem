import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { validateCsrfToken } from "@/lib/csrf";
import { sendEmailMessage } from "@/server/lib/email";

const COMPANY_INQUIRY_EMAIL =
  process.env.COMPANY_INQUIRY_EMAIL ||
  process.env.ORDERS_NOTIFY_EMAIL ||
  process.env.EMAIL_FROM_ADDRESS ||
  "shop.ontap58@gmail.com";
const APP_NAME = process.env.EMAIL_FROM_NAME || "OnTap Team";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function sanitizeText(text: string, max = 500): string {
  return text.trim().replace(/[<>]/g, "").slice(0, max);
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  // Rate limit: 5 per 15 minutes per IP
  const rateCheck = checkRateLimit("inquiry-submit", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many inquiries. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  // CSRF validation (required for mutating endpoints)
  const csrfValid = await validateCsrfToken(request);
  if (!csrfValid) {
    return NextResponse.json(
      { error: "CSRF validation failed.", code: "INVALID_CSRF_TOKEN" },
      { status: 403 }
    );
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

  const {
    customerName,
    customerEmail,
    customerPhone,
    items,
    note: overallNote,
  } = body as {
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    items?: Array<{
      name: string;
      quantity: number;
      unitPrice: number;
      note?: string | null;
      variant?: string | null;
      subscriptionTier?: string | null;
      logoType?: string | null;
    }>;
    note?: string;
  };

  // Validation
  if (!customerName || typeof customerName !== "string" || customerName.trim().length < 2) {
    return NextResponse.json({ error: "Valid customer name is required." }, { status: 400 });
  }
  if (!customerEmail || !isValidEmail(customerEmail)) {
    return NextResponse.json({ error: "Valid customer email is required." }, { status: 400 });
  }
  if (!customerPhone || !isValidPhone(customerPhone)) {
    return NextResponse.json({ error: "Valid phone number is required (10-15 digits)." }, { status: 400 });
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "At least one product is required." }, { status: 400 });
  }

  const sanitizedName = sanitizeText(customerName, 100);
  const sanitizedEmail = customerEmail.trim().toLowerCase();
  const sanitizedPhone = customerPhone.replace(/\D/g, "").slice(0, 15);
  const sanitizedNote = overallNote ? sanitizeText(overallNote, 1000) : "";

  // Build HTML email content
  const itemsHtml = items.map(item => {
    const details = [];
    if (item.variant) details.push(`Variant: ${item.variant}`);
    if (item.subscriptionTier) details.push(`Plan: ${item.subscriptionTier}`);
    if (item.logoType) details.push(`Logo: ${item.logoType}`);
    const detailsHtml = details.length ? `<small style="color:#6c757d;"> (${details.join(", ")})</small>` : "";
    const noteHtml = item.note ? `<div style="margin-top:4px;font-size:12px;color:#495057;">Note: ${sanitizeText(item.note, 200)}</div>` : "";
    return `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #e9ecef;">${sanitizeText(item.name, 100)}${detailsHtml}</td>
        <td style="padding:8px 0;border-bottom:1px solid #e9ecef;text-align:center;">${item.quantity}</td>
        <td style="padding:8px 0;border-bottom:1px solid #e9ecef;text-align:right;">₱${item.unitPrice.toLocaleString()}</td>
        <td style="padding:8px 0;border-bottom:1px solid #e9ecef;text-align:right;">₱${(item.unitPrice * item.quantity).toLocaleString()}</td>
      </tr>
      ${noteHtml ? `<tr><td colspan="4" style="padding:0 0 8px 0;">${noteHtml}</td></tr>` : ""}
    `;
  }).join("");

  const totalAmount = items.reduce((sum, i) => sum + (i.unitPrice * i.quantity), 0);

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>New Product Inquiry</title></head>
<body style="font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:20px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
    <h2 style="margin:0 0 8px;color:#2A4792;">New Product Inquiry</h2>
    <p style="color:#6c757d;margin-bottom:24px;">Submitted via website inquiry form</p>

    <div style="background:#f8f9fa;padding:16px;border-radius:8px;margin-bottom:24px;">
      <h3 style="margin:0 0 12px;font-size:16px;">Customer Details</h3>
      <p><strong>Name:</strong> ${sanitizedName}</p>
      <p><strong>Email:</strong> ${sanitizedEmail}</p>
      <p><strong>Phone:</strong> ${sanitizedPhone}</p>
    </div>

    <h3 style="margin:0 0 12px;font-size:16px;">Products of Interest</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <thead>
        <tr style="border-bottom:2px solid #dee2e6;">
          <th style="padding:8px 0;text-align:left;">Product</th>
          <th style="padding:8px 0;text-align:center;">Qty</th>
          <th style="padding:8px 0;text-align:right;">Unit Price</th>
          <th style="padding:8px 0;text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>${itemsHtml}</tbody>
      <tfoot>
        <tr style="border-top:2px solid #dee2e6;">
          <td colspan="3" style="padding:12px 0;text-align:right;font-weight:bold;">Grand Total:</td>
          <td style="padding:12px 0;text-align:right;font-weight:bold;">₱${totalAmount.toLocaleString()}</td>
        </tr>
      </tfoot>
    </table>

    ${sanitizedNote ? `<div style="margin-top:24px;padding:12px;background:#fff3cd;border-left:4px solid #ffc107;"><strong>Customer Note:</strong><br/>${sanitizedNote}</div>` : ""}

    <p style="margin-top:32px;font-size:12px;color:#adb5bd;">This inquiry was sent from the website product inquiry system. Please respond within 24 hours.</p>
  </div>
</body>
</html>
  `;

  const text = `
New Product Inquiry
-------------------
Customer: ${sanitizedName}
Email: ${sanitizedEmail}
Phone: ${sanitizedPhone}

Products:
${items.map(i => `${i.name} x${i.quantity} - ₱${(i.unitPrice * i.quantity).toLocaleString()}`).join("\n")}
Total: ₱${totalAmount.toLocaleString()}
${sanitizedNote ? `\nCustomer Note: ${sanitizedNote}` : ""}
  `;

  try {
    await sendEmailMessage({
      to: COMPANY_INQUIRY_EMAIL,
      subject: `Product Inquiry from ${sanitizedName}`,
      html,
      text,
      replyTo: sanitizedEmail,
    });

    return NextResponse.json({
      success: true,
      message: "Your inquiry has been sent. We'll get back to you within 24 hours.",
    });
  } catch (error) {
    console.error("[inquiry] email send failed:", error);
    return NextResponse.json(
      { error: "Failed to send inquiry. Please try again later or contact us directly." },
      { status: 500 }
    );
  }
}