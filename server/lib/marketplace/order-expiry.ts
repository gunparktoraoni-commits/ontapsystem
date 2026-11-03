import { prisma } from "@/server/lib/prisma";
import { reconcileShopOrderWithXendit } from "./xendit-order-reconcile";
import { failShopOrderPayment } from "./order-fulfillment";
import type { UserShopOrderWithItems } from "./shop-order-access";

// Xendit invoices in this system live for 24h (see invoiceDurationSeconds).
// Add a small grace window so we never expire an order that Xendit is still
// processing at the boundary.
const DEFAULT_MAX_AGE_HOURS = 25;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

export interface ExpireStaleOrdersResult {
  scanned: number;
  reconciled_paid: number;
  expired: number;
  errors: number;
}

/**
 * Sweep unpaid orders that are older than the invoice lifetime and move them out
 * of the "pending" state so the checkout flow never proceeds on an abandoned or
 * never-completed payment.
 *
 * For each candidate we first ask Xendit whether the invoice was actually paid
 * (a webhook may simply have been missed). Only orders that are still unpaid are
 * expired (marked "cancelled" via {@link failShopOrderPayment}).
 */
export async function expireStalePendingOrders(options?: {
  maxAgeHours?: number;
  limit?: number;
  dryRun?: boolean;
}): Promise<ExpireStaleOrdersResult> {
  const maxAgeHours =
    options?.maxAgeHours && options.maxAgeHours > 0
      ? options.maxAgeHours
      : DEFAULT_MAX_AGE_HOURS;
  const limit = Math.min(Math.max(options?.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

  const candidates = await prisma.shopOrder.findMany({
    where: {
      status: { in: ["pending_payment", "pending"] },
      placed_at: { lt: cutoff },
    },
    include: { items: true },
    orderBy: { placed_at: "asc" },
    take: limit,
  });

  const result: ExpireStaleOrdersResult = {
    scanned: candidates.length,
    reconciled_paid: 0,
    expired: 0,
    errors: 0,
  };

  for (const order of candidates) {
    try {
      const reconcile = await reconcileShopOrderWithXendit(
        order as UserShopOrderWithItems,
      );

      if (reconcile === "completed" || reconcile === "already_completed") {
        // Payment actually went through — leave it as paid, do not expire.
        result.reconciled_paid += 1;
        continue;
      }

      if (reconcile === "failed") {
        // Reconcile already moved it to a failed/cancelled terminal state.
        result.expired += 1;
        continue;
      }

      if (options?.dryRun) continue;

      await failShopOrderPayment(order.id, "EXPIRED");
      result.expired += 1;
    } catch (error) {
      result.errors += 1;
      console.error("[ORDER_EXPIRY] Failed to expire stale order", {
        orderId: order.id.toString(),
        orderNumber: order.order_number,
        error,
      });
    }
  }

  return result;
}
