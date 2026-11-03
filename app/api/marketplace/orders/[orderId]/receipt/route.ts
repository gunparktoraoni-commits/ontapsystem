import { NextRequest, NextResponse } from "next/server";
import {
  resolveRequestSession,
  resolveEffectiveUserId,
  getClientIp,
} from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getShopOrderReceipt } from "@/server/lib/billing/order-receipt";
import { getRequestId } from "@/lib/errors/http";

function serializeForJson(obj: unknown): unknown {
  return JSON.parse(
    JSON.stringify(obj, (_, value) => {
      if (typeof value === "bigint") return value.toString();
      if (value instanceof Date) return value.toISOString();
      if (typeof value === "number" && !Number.isFinite(value)) return 0;
      return value;
    }),
  );
}

function prismaErrorMeta(error: unknown): {
  message: string;
  code?: string;
  meta?: unknown;
} {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }
  const err = error as {
    message?: string;
    code?: string;
    meta?: unknown;
    name?: string;
  };
  return {
    message: err.message || err.name || "Unknown error",
    code: typeof err.code === "string" ? err.code : undefined,
    meta: err.meta,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();

  try {
    const ip = getClientIp(request);
    const rateCheck = checkRateLimit("marketplace-order-status", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: "Too many requests. Please slow down.",
          code: "MARKETPLACE_ORDER_RECEIPT_RATE_LIMITED",
          tag: "[MARKETPLACE_ORDER_RECEIPT]",
        },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        },
      );
    }

    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      return NextResponse.json(
        {
          success: false,
          error: "Authentication required.",
          requiresAuth: true,
          code: "MARKETPLACE_ORDER_RECEIPT_UNAUTHORIZED",
          tag: "[MARKETPLACE_ORDER_RECEIPT]",
        },
        { status: 401 },
      );
    }

    const { orderId } = await params;
    const trimmedOrderId = orderId?.trim();
    if (!trimmedOrderId) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid order ID.",
          code: "MARKETPLACE_ORDER_RECEIPT_INVALID",
          tag: "[MARKETPLACE_ORDER_RECEIPT]",
        },
        { status: 400 },
      );
    }

    const effectiveUserId = resolveEffectiveUserId(auth);
    const receipt = await getShopOrderReceipt(effectiveUserId, trimmedOrderId);

    if (!receipt) {
      return NextResponse.json(
        {
          success: false,
          error: "Order not found.",
          code: "MARKETPLACE_ORDER_NOT_FOUND",
          tag: "[MARKETPLACE_ORDER_RECEIPT]",
        },
        { status: 404 },
      );
    }

    return NextResponse.json(
      serializeForJson({
        success: true,
        data: receipt,
        meta: { requestId, responseTime: Date.now() - startedAt },
      }),
    );
  } catch (error) {
    const details = prismaErrorMeta(error);
    console.error("[MARKETPLACE_ORDER_RECEIPT] Failed to load receipt", {
      requestId,
      ...details,
      error,
    });
    return NextResponse.json(
      {
        success: false,
        error: "Failed to load order receipt.",
        code: details.code || "MARKETPLACE_ORDER_RECEIPT_FAILED",
        tag: "[MARKETPLACE_ORDER_RECEIPT]",
        requestId,
        ...(process.env.NODE_ENV !== "production"
          ? { details: { message: details.message, code: details.code } }
          : {}),
      },
      { status: 500 },
    );
  }
}
