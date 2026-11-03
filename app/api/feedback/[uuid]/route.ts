import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  getFeedbackByUuid,
  parseFeedbackRatings,
  submitOrderFeedback,
} from "@/server/lib/order-feedback";

type RouteContext = { params: Promise<{ uuid: string }> };

function serializeFeedback(row: NonNullable<Awaited<ReturnType<typeof getFeedbackByUuid>>>) {
  const expired = row.expires_at.getTime() < Date.now();
  const submitted = row.status === "submitted" || Boolean(row.submitted_at);

  return {
    uuid: row.uuid,
    status: submitted ? "submitted" : expired ? "expired" : row.status,
    can_submit: !submitted && !expired,
    expires_at: row.expires_at.toISOString(),
    submitted_at: row.submitted_at?.toISOString() ?? null,
    ratings: submitted
      ? {
          overall_rating: row.overall_rating,
          product_rating: row.product_rating,
          delivery_rating: row.delivery_rating,
          recommend: row.recommend,
          message: row.message,
        }
      : null,
    order: {
      order_number: row.order.order_number,
      status: row.order.status,
      currency: row.order.currency,
      items: row.order.items.map((item: { item_name: string; quantity: number }) => ({
        name: item.item_name,
        quantity: item.quantity,
      })),
    },
    user: {
      first_name: row.user.first_name,
    },
  };
}

/**
 * GET /api/feedback/[uuid]
 * Public feedback invitation preview (no auth).
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("order-feedback-read", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)),
        },
      },
    );
  }

  const { uuid } = await context.params;
  const feedback = await getFeedbackByUuid(uuid);
  if (!feedback) {
    return NextResponse.json(
      { success: false, error: "Feedback link is invalid." },
      { status: 404 },
    );
  }

  return NextResponse.json({
    success: true,
    data: serializeFeedback(feedback),
  });
}

/**
 * POST /api/feedback/[uuid]
 * Submit order feedback (one-time).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("order-feedback-submit", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many submissions. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)),
        },
      },
    );
  }

  const { uuid } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const parsed = parseFeedbackRatings(body as Record<string, unknown>);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await submitOrderFeedback(uuid, parsed);
  if (!result.ok) {
    const status =
      result.code === "NOT_FOUND"
        ? 404
        : result.code === "ALREADY_SUBMITTED"
          ? 409
          : result.code === "EXPIRED"
            ? 410
            : 400;
    return NextResponse.json(
      { success: false, error: result.message, code: result.code },
      { status },
    );
  }

  return NextResponse.json({
    success: true,
    message: "Thank you for your feedback!",
    data: {
      uuid: result.feedback.uuid,
      status: result.feedback.status,
      submitted_at: result.feedback.submitted_at?.toISOString() ?? null,
      overall_rating: result.feedback.overall_rating,
    },
  });
}
