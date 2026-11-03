import { Prisma } from "@prisma/client";
import type { RequestLike } from "@/lib/utils/app-base-url";
import { SupportMessagingService } from "@/lib/services/support-messaging.service";
import { prisma } from "@/server/lib/prisma";
import {
  buildCustomThemeBrief,
  CUSTOM_THEME_DEV_VISIBLE_STATUSES,
  CUSTOM_THEME_ORDER_ITEM_TYPE,
  CUSTOM_THEME_PAYMENT_PENDING_STATUSES,
  getCustomThemeRequestFeePhp,
  rowToCustomThemeBriefInput,
  type CustomThemeRequestRow,
} from "@/server/lib/custom-theme-request";
import {
  buildPaymentFailureUrl,
  buildPaymentSuccessUrl,
  calculatePriceBreakdown,
  createPaymentIntentDetailed,
  generateOrderNumber,
  getDefaultCurrency,
  resolvePaymentReturnBaseUrl,
} from "@/server/lib/payment";

function toJsonString(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export type CustomThemePaymentCheckoutResult =
  | {
      ok: true;
      orderId: bigint;
      orderNumber: string;
      invoiceId: string;
      invoiceUrl: string;
      amount: number;
      currency: string;
    }
  | { ok: false; error: string };

/**
 * Create a ShopOrder + Xendit invoice for a custom theme request (server-fixed fee).
 * Does not escalate to dev — that happens only after payment confirmation.
 */
export async function createCustomThemeRequestCheckout(params: {
  request: Pick<
    CustomThemeRequestRow,
    "id" | "user_id" | "reference_number" | "project_name"
  >;
  httpRequest?: RequestLike;
  returnOriginBody?: Record<string, unknown> | null;
  payerEmail: string;
  customerName: string;
}): Promise<CustomThemePaymentCheckoutResult> {
  const fee = getCustomThemeRequestFeePhp();
  const breakdown = calculatePriceBreakdown(fee, 0, false);
  const orderNumber = generateOrderNumber();
  const currency = getDefaultCurrency();
  const appBaseUrl = resolvePaymentReturnBaseUrl(
    params.httpRequest,
    params.returnOriginBody ?? null,
  );
  const successRedirectUrl = buildPaymentSuccessUrl(appBaseUrl, { orderNumber });
  const failureRedirectUrl = buildPaymentFailureUrl(appBaseUrl, { orderNumber });
  const reference =
    params.request.reference_number || `CTR-${params.request.id.toString()}`;

  const piResult = await createPaymentIntentDetailed(
    breakdown.totalAmount,
    currency,
    {
      userId: params.request.user_id.toString(),
      orderNumber,
      payerEmail: params.payerEmail,
      customerName: params.customerName,
      description: `Custom theme request ${reference}`,
      successRedirectUrl,
      failureRedirectUrl,
      items: [
        {
          name: `Custom theme design — ${params.request.project_name}`,
          quantity: 1,
          price: fee,
          category: CUSTOM_THEME_ORDER_ITEM_TYPE,
        },
      ],
      metadata: {
        source: "custom_theme_request",
        userId: params.request.user_id.toString(),
        orderNumber,
        customThemeRequestId: params.request.id.toString(),
        referenceNumber: reference,
      },
    },
  );

  if (!piResult.ok) {
    return { ok: false, error: piResult.error };
  }

  const invoiceId = piResult.payment.id;
  const invoiceUrl = String(piResult.payment.clientSecret ?? "").trim();
  if (!invoiceId || !invoiceUrl || !/^https?:\/\//i.test(invoiceUrl)) {
    return {
      ok: false,
      error:
        "Payment invoice was created without a checkout URL. Please try again.",
    };
  }

  try {
    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.shopOrder.create({
        data: {
          user_id: params.request.user_id,
          order_number: orderNumber,
          status: "pending_payment",
          subtotal: breakdown.subtotal,
          discount_amount: breakdown.discountAmount,
          tax_amount: breakdown.taxAmount,
          shipping_amount: breakdown.shippingAmount,
          total_amount: breakdown.totalAmount,
          currency,
          payment_method: "xendit",
          payment_id: invoiceId,
          xendit_payment_id: invoiceId,
          xendit_invoice_id: invoiceId,
          xendit_invoice_url: invoiceUrl,
          xendit_status: "PENDING",
          notes: `Custom theme request ${reference}`,
        },
      });

      await tx.shopOrderItem.create({
        data: {
          order_id: newOrder.id,
          item_type: CUSTOM_THEME_ORDER_ITEM_TYPE,
          item_id: params.request.id,
          item_name: `Custom theme design — ${params.request.project_name}`,
          quantity: 1,
          unit_price: new Prisma.Decimal(fee),
          total_price: new Prisma.Decimal(fee),
          custom_data: toJsonString({
            custom_theme_request_id: params.request.id.toString(),
            reference_number: reference,
            source: "custom_theme_request",
          }),
        },
      });

      await tx.customThemeRequest.update({
        where: { id: params.request.id },
        data: {
          shop_order_id: newOrder.id,
          payment_amount: new Prisma.Decimal(fee),
          status: "awaiting_payment",
        },
      });

      return newOrder;
    });

    return {
      ok: true,
      orderId: order.id,
      orderNumber,
      invoiceId,
      invoiceUrl,
      amount: breakdown.totalAmount,
      currency,
    };
  } catch (error) {
    console.error("[CUSTOM_THEME_PAYMENT] Failed to persist checkout", error);
    return {
      ok: false,
      error: "Unable to create payment for your theme request. Please try again.",
    };
  }
}

export async function markCustomThemeRequestsFailedForOrder(
  orderId: bigint,
  xenditStatus: string,
): Promise<void> {
  const nextStatus =
    xenditStatus === "EXPIRED" ? "cancelled" : "payment_failed";
  await prisma.customThemeRequest.updateMany({
    where: {
      shop_order_id: orderId,
      status: { in: [...CUSTOM_THEME_PAYMENT_PENDING_STATUSES] },
    },
    data: { status: nextStatus },
  });
}

/**
 * Mark request paid inside an existing shop-order fulfillment transaction.
 * Escalation to Support/Dev runs after the transaction via
 * {@link forwardPaidCustomThemeRequestToDev}.
 */
export async function markCustomThemeRequestPaidInTx(
  tx: Prisma.TransactionClient,
  requestId: bigint,
  orderId: bigint,
  paidAt: Date,
  amount: Prisma.Decimal | number,
): Promise<"activated" | "already_paid" | "not_found"> {
  const existing = await tx.customThemeRequest.findUnique({
    where: { id: requestId },
    select: { id: true, status: true, paid_at: true },
  });
  if (!existing) return "not_found";

  if (
    existing.paid_at ||
    (CUSTOM_THEME_DEV_VISIBLE_STATUSES as readonly string[]).includes(
      existing.status,
    )
  ) {
    await tx.customThemeRequest.update({
      where: { id: requestId },
      data: {
        shop_order_id: orderId,
        payment_amount:
          typeof amount === "number" ? new Prisma.Decimal(amount) : amount,
        ...(existing.paid_at ? {} : { paid_at: paidAt }),
        ...(existing.status === "awaiting_payment" ||
        existing.status === "payment_failed"
          ? { status: "pending" }
          : {}),
      },
    });
    return "already_paid";
  }

  await tx.customThemeRequest.update({
    where: { id: requestId },
    data: {
      status: "pending",
      shop_order_id: orderId,
      paid_at: paidAt,
      payment_amount:
        typeof amount === "number" ? new Prisma.Decimal(amount) : amount,
    },
  });
  return "activated";
}

/**
 * After payment: mirror brief into Support Messaging and escalate to Dev.
 * Idempotent — skips if conversation already linked.
 */
export async function forwardPaidCustomThemeRequestToDev(
  requestId: bigint,
): Promise<{ forwarded: boolean; conversationId: string | null }> {
  const row = await prisma.customThemeRequest.findUnique({
    where: { id: requestId },
  });
  if (!row) {
    return { forwarded: false, conversationId: null };
  }

  if (!row.paid_at && row.status === "awaiting_payment") {
    return { forwarded: false, conversationId: null };
  }

  if (row.conversation_id) {
    return {
      forwarded: false,
      conversationId: row.conversation_id.toString(),
    };
  }

  const reference = row.reference_number || `CTR-${row.id.toString()}`;
  const input = rowToCustomThemeBriefInput(row);
  const brief = buildCustomThemeBrief(input, row.user_id.toString(), reference);
  const CHUNK = 3950;
  const rawChunks: string[] = [];
  for (let i = 0; i < brief.length; i += CHUNK) {
    rawChunks.push(brief.slice(i, i + CHUNK));
  }
  const chunks =
    rawChunks.length <= 1
      ? rawChunks
      : rawChunks.map(
          (chunk, i) =>
            `[Custom theme brief ${i + 1}/${rawChunks.length}]\n\n${chunk}`,
        );

  try {
    const service = new SupportMessagingService();
    const conversation = await service.getOrCreateConversationForClient(
      row.user_id,
    );
    const conversationId = BigInt(conversation.id);

    for (const chunk of chunks) {
      await service.sendMessage(
        conversationId,
        { userId: row.user_id, role: "user" },
        { body: chunk, attachments: [] },
      );
    }

    await service.escalateCustomThemeRequestToDev(
      conversationId,
      row.user_id,
      reference,
    );

    await prisma.customThemeRequest.update({
      where: { id: requestId },
      data: {
        conversation_id: conversationId,
        ...(row.status === "awaiting_payment" || row.status === "payment_failed"
          ? { status: "pending" }
          : {}),
      },
    });

    return { forwarded: true, conversationId: conversationId.toString() };
  } catch (error) {
    console.error(
      "[CUSTOM_THEME_PAYMENT] Failed to forward paid request to support/dev",
      { requestId: requestId.toString(), error },
    );
    return { forwarded: false, conversationId: null };
  }
}

export function parseCustomThemeRequestIdFromOrderItem(item: {
  item_type: string;
  item_id: bigint;
  custom_data: string | null;
}): bigint | null {
  if (item.item_type !== CUSTOM_THEME_ORDER_ITEM_TYPE) return null;
  if (item.custom_data) {
    try {
      const parsed = JSON.parse(item.custom_data) as Record<string, unknown>;
      const fromMeta = parsed.custom_theme_request_id;
      if (fromMeta != null && String(fromMeta).trim()) {
        return BigInt(String(fromMeta));
      }
    } catch {
      // fall through to item_id
    }
  }
  return item.item_id;
}
