import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { prisma } from "@/server/lib/prisma";
import {
  generateCustomThemeReferenceNumber,
  getCustomThemeRequestFeePhp,
  serializeCustomThemeRequest,
  toCustomThemeRequestCreateData,
  customThemeRequestUserInclude,
} from "@/server/lib/custom-theme-request";
import { createCustomThemeRequestCheckout } from "@/server/lib/marketplace/custom-theme-request-payment";

const httpsUrl = z
  .string()
  .trim()
  .url()
  .max(800)
  .refine((value) => /^https?:\/\//i.test(value), {
    message: "Reference image URL must be http(s).",
  });

const customThemeRequestSchema = z.object({
  projectName: z.string().trim().min(2).max(120),
  industry: z.string().trim().max(120).optional().nullable(),
  useCase: z.string().trim().max(500).optional().nullable(),
  targetAudience: z.string().trim().max(400).optional().nullable(),
  primaryGoals: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  themeStyles: z.array(z.string().trim().min(1).max(60)).min(1).max(8),
  mood: z.enum(["light", "dark", "either", "high-contrast"]),
  colorWay: z.object({
    primary: z.string().trim().max(40).optional().nullable(),
    secondary: z.string().trim().max(40).optional().nullable(),
    accent: z.string().trim().max(40).optional().nullable(),
    background: z.string().trim().max(40).optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  }),
  typography: z.object({
    headingStyle: z.string().trim().min(1).max(80),
    bodyStyle: z.string().trim().min(1).max(80),
    tone: z.string().trim().max(60).optional().nullable(),
    preferredFonts: z.string().trim().max(200).optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  }),
  // Removed from UI — kept optional for backward compatibility
  imageryStyle: z.array(z.string().trim().min(1).max(80)).max(8).optional().default([]),
  shapeLanguage: z.string().trim().max(80).optional().nullable(),
  motionPreference: z.string().trim().max(80).optional().nullable(),
  layoutPreferences: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
  mustHaveSections: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  brandPersonality: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  devicePriority: z.string().trim().max(80).optional().nullable(),
  languages: z.string().trim().max(200).optional().nullable(),
  brandAssets: z.enum(["yes", "partial", "none"]).optional().nullable(),
  accessibilityNeeds: z.string().trim().max(400).optional().nullable(),
  deliverableScope: z.string().trim().max(120).optional().nullable(),
  inspirationUrls: z.string().trim().max(1000).optional().nullable(),
  referenceImageUrls: z.array(httpsUrl).max(8).default([]),
  avoidList: z.string().trim().max(800).optional().nullable(),
  competitorNotes: z.string().trim().max(800).optional().nullable(),
  budgetRange: z.string().trim().max(80).optional().nullable(),
  timeline: z.string().trim().max(80).optional().nullable(),
  moreDetails: z.string().trim().min(20).max(4000),
  contactPreference: z.enum(["support_chat", "email", "either"]),
  returnOrigin: z.string().url().optional(),
});

/**
 * POST /api/marketplace/custom-theme-request
 * Saves the brief as awaiting_payment, creates a ₱200 Xendit invoice (same
 * ShopOrder flow as theme purchases). Dev escalation happens only after payment
 * is confirmed via webhook / reconcile.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(request);
  const rate = checkRateLimit("marketplace-custom-theme-request", ip);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: "Too many requests. Please try again later.",
        code: "THEME_REQUEST_RATE_LIMITED",
        tag: "[THEME_REQUEST_API]",
      },
      { status: 429 },
    );
  }

  const resolved = await resolveRequestSession(request, { tryRefresh: true });
  if (!resolved.session) {
    return NextResponse.json(
      {
        success: false,
        error: "Authentication required.",
        code: "THEME_REQUEST_UNAUTHORIZED",
        tag: "[THEME_REQUEST_API]",
      },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid JSON body.",
        code: "THEME_REQUEST_INVALID_JSON",
        tag: "[THEME_REQUEST_API]",
      },
      { status: 400 },
    );
  }

  const parsed = customThemeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Please complete the required theme request fields.",
        code: "THEME_REQUEST_VALIDATION_FAILED",
        tag: "[THEME_REQUEST_API]",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const userId = BigInt(String(resolved.session.userId));
  const referenceNumber = generateCustomThemeReferenceNumber();
  const fee = getCustomThemeRequestFeePhp();
  const bodyRecord =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;

  try {
    // Cancel stale unpaid drafts so users don't accumulate orphan invoices.
    await prisma.customThemeRequest.updateMany({
      where: {
        user_id: userId,
        status: { in: ["awaiting_payment", "payment_failed"] },
      },
      data: { status: "cancelled" },
    });

    const created = await prisma.customThemeRequest.create({
      data: toCustomThemeRequestCreateData(parsed.data, userId, {
        referenceNumber,
        status: "awaiting_payment",
        paymentAmount: fee,
      }),
      include: customThemeRequestUserInclude,
    });

    const user = await prisma.user.findUnique({
      where: { user_id: userId },
      select: { email: true, first_name: true, last_name: true },
    });

    const checkout = await createCustomThemeRequestCheckout({
      request: created,
      httpRequest: request,
      returnOriginBody: bodyRecord,
      payerEmail: user?.email ?? "customer@example.com",
      customerName:
        [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim() ||
        "Customer",
    });

    if (!checkout.ok) {
      await prisma.customThemeRequest.update({
        where: { id: created.id },
        data: { status: "payment_failed" },
      });
      return NextResponse.json(
        {
          success: false,
          error: checkout.error,
          code: "THEME_REQUEST_PAYMENT_CREATE_FAILED",
          tag: "[THEME_REQUEST_API]",
        },
        { status: 503 },
      );
    }

    const refreshed = await prisma.customThemeRequest.findUnique({
      where: { id: created.id },
      include: customThemeRequestUserInclude,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          requiresPayment: true,
          feePhp: fee,
          currency: checkout.currency,
          amount: checkout.amount,
          orderId: checkout.orderId.toString(),
          orderNumber: checkout.orderNumber,
          invoiceId: checkout.invoiceId,
          invoiceUrl: checkout.invoiceUrl,
          // Aliases for clients that read snake_case / nested order shapes
          invoice_url: checkout.invoiceUrl,
          order: {
            id: checkout.orderId.toString(),
            orderNumber: checkout.orderNumber,
            invoiceUrl: checkout.invoiceUrl,
            invoice_url: checkout.invoiceUrl,
            requiresPayment: true,
            totalAmount: checkout.amount,
            currency: checkout.currency,
          },
          request: serializeCustomThemeRequest(refreshed ?? created),
          conversationId: null,
          escalated: false,
          summary: {
            projectName: parsed.data.projectName,
            themeStyles: parsed.data.themeStyles,
            mood: parsed.data.mood,
            referenceNumber,
            referenceImageCount: parsed.data.referenceImageUrls.length,
            feePhp: fee,
          },
        },
        message: `Redirecting to secure payment (₱${fee.toFixed(0)})…`,
      },
      { status: 201 },
    );
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Unable to submit theme request.";
    return NextResponse.json(
      {
        success: false,
        error: msg,
        code: "THEME_REQUEST_CREATE_FAILED",
        tag: "[THEME_REQUEST_API]",
      },
      { status: 500 },
    );
  }
}

/** Public fee for the request modal / storefront. */
export async function GET(): Promise<NextResponse> {
  const fee = getCustomThemeRequestFeePhp();
  return NextResponse.json({
    success: true,
    data: {
      feePhp: fee,
      currency: "PHP",
      requiresPayment: true,
    },
  });
}
