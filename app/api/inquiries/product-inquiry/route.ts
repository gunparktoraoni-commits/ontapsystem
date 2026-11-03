// app/api/inquiries/product-inquiry/route.ts

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { validateCsrfToken } from "@/lib/csrf";
import { sendEmailMessage } from "@/server/lib/email";
import {
  buildInquiryTitle,
  generateInquiryReferenceNumber,
  notifyAllStaffForProductInquiry,
  parseInquiryAttachments,
  serializeInquiryRecord,
  type ProductInquiryLineItem,
} from "@/server/lib/product-inquiry";

type InquiryItemInput = {
  productId?: string | number;
  productName?: string;
  quantity?: number;
  unitPrice?: number;
  variant?: string | null;
  subscriptionTier?: string | null;
  logoType?: string | null;
  note?: string | null;
  imageUrl?: string | null;
  cartItemId?: string | null;
};

type InquiryBody = {
  name?: string;
  email?: string;
  contact?: string;
  note?: string | null;
  title?: string | null;
  source?: string | null;
  items?: InquiryItemInput[];
  attachments?: unknown;
  clearCartItemIds?: string[];
};

async function requireSession(request: NextRequest) {
  const result = await resolveRequestSession(request);
  if (!result.session) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Authentication required.", requiresAuth: true },
        { status: 401 },
      ),
    };
  }
  return { ok: true as const, session: result.session };
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>]/g, (m) => {
    if (m === "&") return "&amp;";
    if (m === "<") return "&lt;";
    if (m === ">") return "&gt;";
    return m;
  });
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID?.() || Date.now().toString(36);
  const tag = "[PRODUCT_INQUIRY]";

  try {
    const ip = getClientIp(request);
    const rateCheck = checkRateLimit("product-inquiry", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        },
      );
    }

    const auth = await requireSession(request);
    if (!auth.ok) return auth.response;
    const userId = auth.session.userId;
    if (userId == null) {
      return NextResponse.json(
        { error: "Invalid session: user ID not found." },
        { status: 401 },
      );
    }

    const csrfValid = await validateCsrfToken(request);
    if (!csrfValid) {
      return NextResponse.json(
        { error: "CSRF validation failed.", code: "INVALID_CSRF_TOKEN" },
        { status: 403 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body." },
        { status: 400 },
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, error: "Invalid request payload." },
        { status: 400 },
      );
    }

    const {
      name,
      email,
      contact,
      note,
      title,
      source,
      items,
      attachments,
      clearCartItemIds,
    } = body as InquiryBody;

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return NextResponse.json(
        { success: false, error: "Valid name is required (minimum 2 characters)." },
        { status: 400 },
      );
    }
    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { success: false, error: "Valid email address is required." },
        { status: 400 },
      );
    }
    if (!contact || typeof contact !== "string" || !/^09\d{9}$/.test(contact.replace(/\D/g, ""))) {
      return NextResponse.json(
        {
          success: false,
          error: "Valid Philippine mobile number (09xxxxxxxxx) is required.",
        },
        { status: 400 },
      );
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: "At least one item is required." },
        { status: 400 },
      );
    }

    const sanitizedName = name.trim().slice(0, 255);
    const sanitizedEmail = email.trim().toLowerCase().slice(0, 255);
    const sanitizedContact = contact.replace(/\D/g, "").slice(0, 11);
    const sanitizedNote = note ? String(note).trim().slice(0, 4000) : null;
    const sanitizedSource =
      typeof source === "string" && source.trim()
        ? source.trim().slice(0, 40)
        : "marketplace";

    let userBigInt: bigint;
    try {
      userBigInt = BigInt(userId);
    } catch {
      return NextResponse.json({ error: "Invalid user identifier." }, { status: 400 });
    }

    const serializedItems: ProductInquiryLineItem[] = items.map((item) => ({
      productId: String(item.productId ?? ""),
      productName: String(item.productName || "Product").slice(0, 255),
      quantity: Math.max(1, Math.min(999, Number(item.quantity) || 1)),
      unitPrice: Math.max(0, Number(item.unitPrice) || 0),
      variant: item.variant ? String(item.variant).slice(0, 120) : null,
      subscriptionTier: item.subscriptionTier
        ? String(item.subscriptionTier).slice(0, 80)
        : null,
      logoType: item.logoType ? String(item.logoType).slice(0, 40) : null,
      note: item.note ? String(item.note).trim().slice(0, 1000) : null,
      imageUrl: item.imageUrl ? String(item.imageUrl).slice(0, 1000) : null,
      cartItemId: item.cartItemId ? String(item.cartItemId).slice(0, 64) : null,
    }));

    const attachmentList = parseInquiryAttachments(
      JSON.stringify(Array.isArray(attachments) ? attachments : []),
    );
    const inquiryTitle =
      typeof title === "string" && title.trim().length > 0
        ? title.trim().slice(0, 255)
        : buildInquiryTitle(serializedItems);
    const referenceNumber = generateInquiryReferenceNumber();

    const inquiry = await prisma.productInquiry.create({
      data: {
        user_id: userBigInt,
        reference_number: referenceNumber,
        title: inquiryTitle,
        name: sanitizedName,
        email: sanitizedEmail,
        contact: sanitizedContact,
        note: sanitizedNote,
        items: JSON.stringify(serializedItems),
        attachments: attachmentList.length > 0 ? JSON.stringify(attachmentList) : null,
        status: "pending",
        source: sanitizedSource,
      },
    });

    // Optionally clear inquired cart items so they don't go to paid checkout next.
    const cartIdsToClear = Array.isArray(clearCartItemIds)
      ? clearCartItemIds.map(String).filter(Boolean)
      : serializedItems.map((i) => i.cartItemId).filter((id): id is string => Boolean(id));

    if (cartIdsToClear.length > 0) {
      try {
        const bigIds: bigint[] = [];
        for (const id of cartIdsToClear) {
          try {
            const parsed = BigInt(id);
            if (parsed > BigInt(0)) bigIds.push(parsed);
          } catch {
            // skip non-numeric ids
          }
        }
        if (bigIds.length > 0) {
          await prisma.cartItem.deleteMany({
            where: {
              user_id: userBigInt,
              id: { in: bigIds },
            },
          });
        }
      } catch (clearErr) {
        console.warn(`${tag} Failed to clear cart items after inquiry`, {
          requestId,
          error: clearErr,
        });
      }
    }

    // Notify all staff (non-blocking for response)
    void notifyAllStaffForProductInquiry({
      inquiryId: inquiry.id,
      referenceNumber,
      title: inquiryTitle,
      clientUserId: userBigInt,
      customerName: sanitizedName,
    }).catch((err) => {
      console.error(`${tag} Staff notify failed`, { requestId, error: err });
    });

    const companyEmail =
      process.env.COMPANY_INQUIRY_EMAIL || process.env.SMTP_USER || "support@example.com";

    const itemsHtml = serializedItems
      .map(
        (item) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(item.productName)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${item.variant ? escapeHtml(item.variant) : "—"}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${item.note ? escapeHtml(item.note) : "—"}</td>
      </tr>`,
      )
      .join("");

    const attachmentsHtml =
      attachmentList.length > 0
        ? `<p><strong>Attachments:</strong></p><ul>${attachmentList
            .map(
              (file) =>
                `<li><a href="${escapeHtml(file.url)}">${escapeHtml(file.name)}</a></li>`,
            )
            .join("")}</ul>`
        : "";

    const html = `
      <h2>New Product Inquiry</h2>
      <p><strong>Reference:</strong> ${escapeHtml(referenceNumber)}</p>
      <p><strong>Title:</strong> ${escapeHtml(inquiryTitle)}</p>
      <p><strong>Customer:</strong> ${escapeHtml(sanitizedName)}</p>
      <p><strong>Email:</strong> ${escapeHtml(sanitizedEmail)}</p>
      <p><strong>Contact:</strong> ${sanitizedContact}</p>
      <p><strong>Note:</strong> ${sanitizedNote ? escapeHtml(sanitizedNote) : "—"}</p>
      <h3>Items Requested</h3>
      <table style="width: 100%; border-collapse: collapse; margin-top: 12px;">
        <thead>
          <tr style="background: #f3f4f6;">
            <th style="padding: 8px; text-align: left;">Product</th>
            <th style="padding: 8px; text-align: center;">Qty</th>
            <th style="padding: 8px; text-align: left;">Variant</th>
            <th style="padding: 8px; text-align: left;">Item note</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      ${attachmentsHtml}
      <p style="margin-top: 24px;">Open in staff portal: /staff/product-inquiries</p>
    `;

    const text = `
New Product Inquiry (${referenceNumber})
Title: ${inquiryTitle}
Customer: ${sanitizedName}
Email: ${sanitizedEmail}
Contact: ${sanitizedContact}
Note: ${sanitizedNote || "—"}

Items:
${serializedItems
  .map((i) => `- ${i.productName} x${i.quantity}${i.variant ? ` (${i.variant})` : ""}`)
  .join("\n")}
`;

    try {
      await sendEmailMessage({
        to: companyEmail,
        subject: `[${referenceNumber}] ${inquiryTitle}`,
        html,
        text,
        replyTo: sanitizedEmail,
      });
    } catch (emailError) {
      console.error(`${tag} Email send failed`, { requestId, error: emailError });
    }

    return NextResponse.json({
      success: true,
      data: serializeInquiryRecord(inquiry),
      message:
        "Inquiry submitted successfully. Our team will review it and contact you shortly.",
    });
  } catch (error) {
    console.error(`${tag} Unhandled error`, { requestId, error });
    return NextResponse.json(
      {
        success: false,
        error: "An internal error occurred. Please try again later.",
        code: "INTERNAL_SERVER_ERROR",
        requestId,
      },
      { status: 500 },
    );
  }
}
