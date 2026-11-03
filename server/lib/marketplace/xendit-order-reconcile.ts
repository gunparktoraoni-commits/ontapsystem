import { prisma } from "@/server/lib/prisma";
import { getXenditInvoice, getXenditSecretKeyOrNull } from "@/server/lib/xendit";
import type { UserShopOrderWithItems } from "@/server/lib/marketplace/shop-order-access";
import { findUserShopOrder } from "@/server/lib/marketplace/shop-order-access";
import {
  XENDIT_FAILURE_STATUSES,
  XENDIT_SUCCESS_STATUSES,
  TERMINAL_ORDER_STATUSES,
  failShopOrderPayment,
  fulfillPaidShopOrder,
  markShopOrderAmountMismatch,
  xenditAmountsMatch,
} from "@/server/lib/marketplace/order-fulfillment";

export type ReconcileResult =
  | "unchanged"
  | "completed"
  | "already_completed"
  | "failed"
  | "pending"
  | "amount_mismatch"
  | "invoice_not_found"
  | "reconcile_unavailable";

function normalizeStatus(status: string | undefined): string {
  return (status ?? "").trim().toUpperCase();
}

export async function reconcileShopOrderWithXendit(
  order: UserShopOrderWithItems,
): Promise<ReconcileResult> {
  if (TERMINAL_ORDER_STATUSES.has(order.status)) {
    return "unchanged";
  }

  const invoiceId = order.xendit_invoice_id?.trim();
  if (!invoiceId) {
    return "unchanged";
  }

  try {
    const invoice = await getXenditInvoice(invoiceId);
    if (!invoice) {
      if (!getXenditSecretKeyOrNull()) {
        return "reconcile_unavailable";
      }
      return "invoice_not_found";
    }

    const status = normalizeStatus(invoice.status);
    const expectedAmount = Number(order.total_amount);
    const receivedAmount = Number(
      (invoice as { paid_amount?: number }).paid_amount ?? invoice.amount ?? 0,
    );

    if (XENDIT_SUCCESS_STATUSES.has(status)) {
      if (!xenditAmountsMatch(receivedAmount, expectedAmount)) {
        await markShopOrderAmountMismatch(order.id);
        return "amount_mismatch";
      }

      const fulfillment = await fulfillPaidShopOrder(order.id, {
        xenditInvoiceId: invoice.id,
        status,
        paidAt: (invoice as { paid_at?: string }).paid_at,
        paymentMethod:
          (invoice as { payment_method?: string }).payment_method ?? null,
      });

      if (fulfillment === "already_completed") return "already_completed";
      if (fulfillment === "fulfilled") return "completed";
      return "unchanged";
    }

    if (XENDIT_FAILURE_STATUSES.has(status)) {
      await failShopOrderPayment(order.id, status);
      return "failed";
    }

    if (status === "PENDING") {
      await prisma.shopOrder.update({
        where: { id: order.id },
        data: { xendit_status: status },
      });
      return "pending";
    }

    await prisma.shopOrder.update({
      where: { id: order.id },
      data: { xendit_status: status },
    });
    return "pending";
  } catch (error) {
    console.error("[MARKETPLACE_ORDER_STATUS] Xendit reconcile failed", {
      orderId: order.id.toString(),
      orderNumber: order.order_number,
      invoiceId,
      error,
    });
    return "reconcile_unavailable";
  }
}

export async function reconcileUserShopOrderByIdentifier(
  userId: bigint,
  orderIdentifier: string,
): Promise<{
  order: UserShopOrderWithItems | null;
  reconcileResult: ReconcileResult | null;
}> {
  const order = await findUserShopOrder(userId, orderIdentifier);
  if (!order) {
    return { order: null, reconcileResult: null };
  }

  if (TERMINAL_ORDER_STATUSES.has(order.status)) {
    return { order, reconcileResult: "unchanged" };
  }

  const reconcileResult = await reconcileShopOrderWithXendit(order);
  if (
    reconcileResult === "unchanged" ||
    reconcileResult === "invoice_not_found" ||
    reconcileResult === "reconcile_unavailable"
  ) {
    return { order, reconcileResult };
  }

  const refreshed = await findUserShopOrder(userId, orderIdentifier);
  return { order: refreshed, reconcileResult };
}
