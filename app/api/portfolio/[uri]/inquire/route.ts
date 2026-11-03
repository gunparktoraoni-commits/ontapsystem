import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { validateInquiryInput } from "@/server/lib/validators";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getUserDisplayName, logActivity } from "@/server/lib/activity";
import { createNotificationFromEvent } from "@/server/lib/notifications";
import { resolveInquiryAssignee } from "@/lib/services/staff-client-assignment";

const CUSTOM_URI_REGEX = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]{2,64}$/;

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
const portfolioCache = new Map<string, { userId: bigint; bizcardId: bigint; subscription_tier: string | null; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;
async function getPortfolioOwner(uri: string): Promise<{ userId: bigint; bizcardId: bigint; subscription_tier: string | null } | null> {
  const cached = portfolioCache.get(uri);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return { userId: cached.userId, bizcardId: cached.bizcardId, subscription_tier: cached.subscription_tier };
  }
  const owner = await prisma.bizcard.findFirst({
    where: {
      url_alias: uri,
      deactivated_flag: false,
      user: {
        is: {
          is_active: true,
        },
      },
    },
    select: {
      user_id: true,
      bizcard_id: true,
      subscription_tier: true,
    },
  });
  if (owner?.user_id && owner.bizcard_id) {
    portfolioCache.set(uri, {
      userId: owner.user_id,
      bizcardId: owner.bizcard_id,
      subscription_tier: owner.subscription_tier,
      timestamp: Date.now(),
    });
    return { userId: owner.user_id, bizcardId: owner.bizcard_id, subscription_tier: owner.
      subscription_tier };
  }
  return null;
}





interface InquiryBody {

  name: string;
  email: string;
  message: string;
  subject?: string;
  phone?: string;
  sessionId?: string;

}




/**
 * 
 * Handle CORS preflight requests
 * Browser sends OPTIONS before POST for cross-origin requests
 */
export async function OPTIONS(
  request: NextRequest,
  { params }: { params: Promise<{ uri: string }> }
) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ uri: string }> }
) {
  const ip = getClientIp(request);
  const startTime = Date.now();

  try {
    // ── Rate Limiting (Early rejection) ──────────────────────────────
    const rateCheck = checkRateLimit("inquiry-submit", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many messages sent. Please wait before trying again." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    // ── Validate URI param ─────────────────────────
    const { uri } = await params;
    if (!uri || !CUSTOM_URI_REGEX.test(uri)) {
      return NextResponse.json({ error: "Portfolio not found." }, { status: 404 });
    }

    // ── Parse body (with size limits) ──────────────────────
    let body: InquiryBody;
    try {
      const rawBody = await request.text();
      if (rawBody.length > 10 * 1024) { // 10KB limit for inquiry body
        return NextResponse.json({ error: "Request body too large." }, { status: 413 });
      }
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    // ── Validate input ────────────────────────────────
    const validation = validateInquiryInput(body as unknown as Record<string, unknown>);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.errors[0], errors: validation.errors },
        { status: 422 }
      );
    }
    const { name, email, message, subject, phone } = validation.data;

    // ── Optional session extraction (non-blocking) ────────────────
    let senderUserId: number | null = null;
    const sessionToken = request.cookies.get("session_token")?.value;
    if (sessionToken) {
      try {
        const session = await validateToken(sessionToken);
        if (session) senderUserId = session.userId;
      } catch {
        // Non-fatal — treat as anonymous inquiry
      }
    }

    // ── Resolve portfolio owner (cached) ────────────────────
    const portfolioOwner = await getPortfolioOwner(uri);
    if (!portfolioOwner) {
      return NextResponse.json({ error: "Portfolio not found." }, { status: 404 });
    }
    const { userId: ownerUserId, bizcardId, subscription_tier } = portfolioOwner;

    if (subscription_tier !== "premium") {
      return NextResponse.json(
        { error: "Inquiries are only available for premium portfolios." },
        { status: 403 }
      );
    }

    // ── Self-inquiry guard ─────────────────────────
    if (senderUserId && senderUserId === Number(ownerUserId)) {
      return NextResponse.json(
        { error: "You cannot send an inquiry to your own portfolio." },
        { status: 422 }
      );
    }

    // ── Parallel execution: staff assignment & inquiry creation ──
    const [assignedToStaffId, inquiry] = await Promise.all([
      resolveInquiryAssignee(senderUserId ? BigInt(senderUserId) : null),
      prisma.inquiry.create({
        data: {
          user_id: ownerUserId,
          bizcard_id: bizcardId,
          sender_user_id: senderUserId ? BigInt(senderUserId) : null,
          visitor_name: name,
          visitor_email: email,
          visitor_phone: phone,
          subject: subject,
          message: message,
          status: "new",
          read_flag: false,
          assigned_to_staff_id: null, // Will be updated if staff assigned
        },
      })
    ]);

    // Update with staff assignment if needed (separate query to avoid race conditions)
    let finalInquiry = inquiry;
    if (assignedToStaffId) {
      finalInquiry = await prisma.inquiry.update({
        where: { inquiry_id: inquiry.inquiry_id },
        data: { assigned_to_staff_id: assignedToStaffId },
      });
    }

    // ── Fire-and-forget: background tasks ──────────────────
    // Don't await these - let them run in background
    const backgroundTasks = [];

    if (assignedToStaffId) {
      backgroundTasks.push(
        logActivity(
          Number(assignedToStaffId),
          "INQUIRY_ROUTED",
          finalInquiry.inquiry_id,
          { senderName: name, senderUserId }
        ).catch(err => console.error("[background] Staff routing log failed:", err))
      );
    }

    backgroundTasks.push(
      logActivity(
        Number(ownerUserId),
        "NEW_INQUIRY",
        finalInquiry.inquiry_id,
        { senderName: name }
      ).catch(err => console.error("[background] Activity log failed:", err))
    );

    if (senderUserId) {
      backgroundTasks.push(
        getUserDisplayName(ownerUserId).then((ownerName) =>
          logActivity(
            Number(senderUserId),
            "INQUIRY_SENT",
            finalInquiry.inquiry_id,
            { targetName: ownerName, ownerUserId: ownerUserId.toString() },
          ),
        ).catch((err) => console.error("[background] Inquiry sent log failed:", err))
      );
    }

    backgroundTasks.push(
      createNotificationFromEvent({
        targetUserId: ownerUserId,
        triggerUserId: senderUserId ? BigInt(senderUserId) : null,
        eventType: "inquiry_sent",
        priority: "high",
        metadata: {
          sender_name: name,
          subject: subject ?? null,
        },
        needsEmail: true,
        emailPriority: "immediate",
      }).catch(err => console.error("[background] Notification failed:", err))
    );

    // Execute background tasks without awaiting
    Promise.allSettled(backgroundTasks);

    // Log performance metric (for monitoring)
    const duration = Date.now() - startTime;
    if (duration > 1000) {
      console.warn(`[performance] Inquiry submission slow: ${duration}ms for URI: ${uri}`);
    }

    return NextResponse.json(
      serialize({
        inquiryId: finalInquiry.inquiry_id,
        message: "Your inquiry has been sent. The portfolio owner will reach out to you.",
        linkedAccount: senderUserId !== null,
      }),
      { status: 201 }
    );
  } catch (err) {
    console.error("[portfolio/inquire] Unhandled error:", err);
    
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again later." },
      { status: 500 }
    );
  }
}