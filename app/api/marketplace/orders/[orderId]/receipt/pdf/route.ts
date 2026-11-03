import { NextRequest, NextResponse } from "next/server";
import {
  resolveRequestSession,
  resolveEffectiveUserId,
  getClientIp,
} from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getShopOrderReceipt } from "@/server/lib/billing/order-receipt";
import { buildOrderReceiptPdf } from "@/server/lib/billing/order-receipt-pdf";
import { getRequestId } from "@/lib/errors/http";

function convertBigIntsToNumbers(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "bigint") return Number(obj);
  if (typeof obj === "object" && obj !== null && "toNumber" in obj) {
    try {
      return (obj as { toNumber: () => number }).toNumber();
    } catch {
      return obj;
    }
  }
  if (Array.isArray(obj)) return obj.map(convertBigIntsToNumbers);
  if (typeof obj === "object" && obj.constructor === Object) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = convertBigIntsToNumbers(value);
    }
    return result;
  }
  return obj;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const requestId = getRequestId(request.headers);

  try {
    const ip = getClientIp(request);
    const rateCheck = checkRateLimit("marketplace-order-status", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        },
      );
    }

    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      return NextResponse.json(
        { success: false, error: "Authentication required.", requiresAuth: true },
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

    const receipt = await getShopOrderReceipt(
      resolveEffectiveUserId(auth),
      trimmedOrderId,
    );

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

    const normalizedReceipt = convertBigIntsToNumbers(receipt) as typeof receipt;

    if (
      !normalizedReceipt.business?.name ||
      !normalizedReceipt.customer?.name ||
      !normalizedReceipt.items?.length
    ) {
      console.error("[MARKETPLACE_ORDER_RECEIPT] Invalid receipt data structure", {
        requestId,
        orderId: trimmedOrderId,
        hasBusinessName: !!normalizedReceipt.business?.name,
        hasCustomerName: !!normalizedReceipt.customer?.name,
        itemsCount: normalizedReceipt.items?.length ?? 0,
      });
      return NextResponse.json(
        {
          success: false,
          error: "Invalid order data.",
          code: "MARKETPLACE_ORDER_RECEIPT_INVALID_DATA",
          tag: "[MARKETPLACE_ORDER_RECEIPT]",
        },
        { status: 400 },
      );
    }

    const pdfBytes = await buildOrderReceiptPdf(normalizedReceipt);
    const fileName = `receipt-${receipt.order_number}.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
        "X-Request-ID": requestId,
      },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[MARKETPLACE_ORDER_RECEIPT] Failed to generate PDF", {
      requestId,
      error: errorMsg,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      {
        success: false,
        error: "Failed to generate order receipt PDF.",
        code: "MARKETPLACE_ORDER_RECEIPT_PDF_FAILED",
        tag: "[MARKETPLACE_ORDER_RECEIPT]",
        ...(process.env.NODE_ENV !== "production"
          ? { details: { message: errorMsg } }
          : {}),
      },
      { status: 500 },
    );
  }
}
