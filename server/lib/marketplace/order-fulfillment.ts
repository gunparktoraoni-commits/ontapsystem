import type { Prisma, ShopOrder, ShopOrderItem } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { sendOrderConfirmationEmail } from "@/server/lib/email";
import { attributePaidShopOrderCommission } from "@/server/lib/staff-commission";
import {
  forwardPaidCustomThemeRequestToDev,
  markCustomThemeRequestPaidInTx,
  markCustomThemeRequestsFailedForOrder,
  parseCustomThemeRequestIdFromOrderItem,
} from "@/server/lib/marketplace/custom-theme-request-payment";

export const XENDIT_SUCCESS_STATUSES = new Set(["PAID", "SETTLED"]);
export const XENDIT_FAILURE_STATUSES = new Set(["EXPIRED", "FAILED", "VOIDED"]);

// Raw shopOrder.status value assigned the moment Xendit confirms a payment.
// It is intentionally distinct from "completed" (which now means the order has
// been fully fulfilled/finished by an operator) so the two states never clash.
export const PAYMENT_COMPLETED_STATUS = "paid";

// Raw statuses that mean "payment has already been confirmed for this order".
// Used to make fulfillment idempotent (never grant goods / create purchase logs
// twice) and to stop the reconciler from re-processing an already-paid order.
export const PAYMENT_CONFIRMED_STATUSES = new Set([
  "paid",
  "processing",
  "shipped",
  "delivered",
  "completed",
  "refunded",
]);

// Raw statuses whose revenue should be recognized (payment received, not reversed).
export const REVENUE_RECOGNIZED_STATUSES = [
  "paid",
  "processing",
  "shipped",
  "delivered",
  "completed",
];

// Statuses the Xendit reconciler should never re-check: either payment is already
// confirmed, or the order has failed/cancelled. Only pending states get reconciled.
export const TERMINAL_ORDER_STATUSES = new Set([
  "paid",
  "processing",
  "shipped",
  "delivered",
  "completed",
  "refunded",
  "cancelled",
  "payment_failed",
]);

type OrderWithItems = ShopOrder & { items: ShopOrderItem[] };

export function usesXenditMinorUnits(): boolean {
  return String(process.env.XENDIT_USE_MINOR_UNITS ?? "false").toLowerCase() === "true";
}

export function normalizeXenditPaidAmount(
  receivedAmount: number,
  expectedOrderTotal: number,
): number {
  if (!Number.isFinite(receivedAmount)) return receivedAmount;
  if (!usesXenditMinorUnits()) return receivedAmount;

  const asMajor = receivedAmount / 100;
  if (Math.abs(asMajor - expectedOrderTotal) <= 0.01) return asMajor;
  return receivedAmount;
}

export function xenditAmountsMatch(
  receivedAmount: number,
  expectedOrderTotal: number,
): boolean {
  const normalized = normalizeXenditPaidAmount(receivedAmount, expectedOrderTotal);
  return Math.abs(expectedOrderTotal - normalized) <= 0.01;
}

function parseCustomData(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function clearCartItemsForOrder(
  tx: Prisma.TransactionClient,
  order: Pick<ShopOrder, "user_id"> & { items: Pick<ShopOrderItem, "custom_data">[] },
): Promise<number> {
  const originIds: bigint[] = [];
  for (const item of order.items) {
    const parsed = parseCustomData(item.custom_data);
    const originId = parsed.origin_cart_item_id;
    if (!originId) continue;
    try {
      originIds.push(BigInt(String(originId)));
    } catch {
      // ignore invalid cart item ids
    }
  }

  if (originIds.length === 0) return 0;

  const result = await tx.cartItem.deleteMany({
    where: { user_id: order.user_id, id: { in: originIds } },
  });
  return result.count;
}

export async function failShopOrderPayment(
  orderId: bigint,
  status: string,
): Promise<void> {
  await prisma.shopOrder.update({
    where: { id: orderId },
    data: {
      status: status === "EXPIRED" ? "cancelled" : "payment_failed",
      xendit_status: status,
    },
  });
  try {
    await markCustomThemeRequestsFailedForOrder(orderId, status);
  } catch (error) {
    console.warn("[ORDER_FULFILLMENT] Failed to mark custom theme request unpaid", {
      orderId: orderId.toString(),
      error,
    });
  }
}

export async function markShopOrderAmountMismatch(orderId: bigint): Promise<void> {
  const order = await prisma.shopOrder.findUnique({
    where: { id: orderId },
    select: { status: true },
  });
  if (!order) return;

  await prisma.shopOrder.update({
    where: { id: orderId },
    data: {
      xendit_status: "AMOUNT_MISMATCH",
      // Never downgrade an order whose payment was already confirmed.
      status: PAYMENT_CONFIRMED_STATUSES.has(order.status)
        ? order.status
        : "payment_failed",
    },
  });

  if (!PAYMENT_CONFIRMED_STATUSES.has(order.status)) {
    try {
      await markCustomThemeRequestsFailedForOrder(orderId, "FAILED");
    } catch (error) {
      console.warn(
        "[ORDER_FULFILLMENT] Failed to mark custom theme request after amount mismatch",
        { orderId: orderId.toString(), error },
      );
    }
  }
}

export type FulfillPaidShopOrderInput = {
  xenditInvoiceId: string;
  status: string;
  paidAt?: string;
  paymentMethod?: string | null;
};

export async function fulfillPaidShopOrder(
  orderId: bigint,
  input: FulfillPaidShopOrderInput,
): Promise<"fulfilled" | "already_completed" | "not_found"> {
  let emailRecipient: string | null = null;
  let emailPayload: Parameters<typeof sendOrderConfirmationEmail>[1] | null = null;
  let affiliateMeta: Record<string, unknown> | null = null;
  let referredUserId: bigint | null = null;
  let orderTotal = 0;
  const customThemeRequestIdsToForward: bigint[] = [];

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.shopOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) return "not_found" as const;

    const extractAffiliateMeta = () => {
      referredUserId = order.user_id;
      orderTotal = Number(order.total_amount);
      for (const item of order.items) {
        const customData = parseCustomData(item.custom_data);
        const affiliate = customData.affiliate;
        if (affiliate && typeof affiliate === "object" && !Array.isArray(affiliate)) {
          affiliateMeta = affiliate as Record<string, unknown>;
          break;
        }
      }
    };

    if (PAYMENT_CONFIRMED_STATUSES.has(order.status)) {
      // Payment already confirmed (duplicate webhook / reconcile / operator advance).
      // Refresh Xendit metadata only; never re-run fulfillment side-effects.
      await tx.shopOrder.update({
        where: { id: orderId },
        data: {
          xendit_status: input.status,
          xendit_payment_id: input.xenditInvoiceId,
          ...(input.paymentMethod
            ? { xendit_payment_method: input.paymentMethod }
            : {}),
        },
      });
      for (const item of order.items) {
        const customThemeRequestId = parseCustomThemeRequestIdFromOrderItem(item);
        if (customThemeRequestId) {
          customThemeRequestIdsToForward.push(customThemeRequestId);
        }
      }
      extractAffiliateMeta();
      return "already_completed" as const;
    }

    for (const item of order.items) {
      await tx.purchaseLog.create({
        data: {
          user_id: order.user_id,
          purchase_type: item.item_type,
          item_id: item.item_id,
          item_name: item.item_name,
          amount: item.total_price,
          order_id: order.id,
          status: "completed",
        },
      });

      if (item.item_type === "template") {
        await tx.templatePurchase.upsert({
          where: {
            user_id_template_id: {
              user_id: order.user_id,
              template_id: item.item_id,
            },
          },
          update: { order_id: order.id },
          create: {
            user_id: order.user_id,
            template_id: item.item_id,
            order_id: order.id,
            price_paid: item.unit_price,
          },
        });
      }

      const customThemeRequestId = parseCustomThemeRequestIdFromOrderItem(item);
      if (customThemeRequestId) {
        const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
        const activation = await markCustomThemeRequestPaidInTx(
          tx,
          customThemeRequestId,
          order.id,
          paidAt,
          item.total_price,
        );
        if (activation === "activated" || activation === "already_paid") {
          customThemeRequestIdsToForward.push(customThemeRequestId);
        }
      }

      if (item.item_type === "subscription_plan") {
        const customData = parseCustomData(item.custom_data);
        const bizcardSerialId = customData.bizcardSerialId;
        if (typeof bizcardSerialId === "string" && bizcardSerialId.trim()) {
          const bizcard = await tx.bizcard.findFirst({
            where: { serial_id: bizcardSerialId, user_id: order.user_id },
          });
          if (bizcard) {
            const now = new Date();
            const expiry = new Date(now);
            const billingCycle =
              customData.billing_cycle === "yearly" ? "yearly" : "monthly";
            if (billingCycle === "yearly") {
              expiry.setFullYear(expiry.getFullYear() + 1);
            } else {
              expiry.setMonth(expiry.getMonth() + 1);
            }

            const plan = await tx.subscriptionPlan.findUnique({
              where: { id: item.item_id },
            });

            await tx.bizcardSubscription.upsert({
              where: { bizcard_id: bizcard.bizcard_id },
              update: {
                plan_id: item.item_id,
                status: "active",
                billing_cycle: billingCycle,
                started_at: input.paidAt ? new Date(input.paidAt) : now,
                expires_at: expiry,
                auto_renew: true,
                xendit_invoice_id: input.xenditInvoiceId,
              },
              create: {
                bizcard_id: bizcard.bizcard_id,
                plan_id: item.item_id,
                status: "active",
                billing_cycle: billingCycle,
                started_at: input.paidAt ? new Date(input.paidAt) : now,
                expires_at: expiry,
                auto_renew: true,
                xendit_invoice_id: input.xenditInvoiceId,
              },
            });

            await tx.bizcard.update({
              where: { bizcard_id: bizcard.bizcard_id },
              data: {
                subscription_tier: plan?.tier_code ?? null,
                subscription_started_at: input.paidAt ? new Date(input.paidAt) : now,
                subscription_expires_at: expiry,
                subscription_status: "active",
              },
            });

            const purchasedTier = String(plan?.tier_code ?? "").trim().toLowerCase();
            if (purchasedTier === "basic" || purchasedTier === "standard") {
              const { maybeApplyTrialUpgradePremiumBoost } = await import(
                "@/lib/services/premium-experience.service"
              );
              await maybeApplyTrialUpgradePremiumBoost({
                userId: order.user_id,
                purchasedTier,
                tx,
              });
            }
          }
        }
      }
    }

    try {
      await clearCartItemsForOrder(tx, order);
    } catch (error) {
      console.warn("[ORDER_FULFILLMENT] Failed to clear cart items", {
        orderId: orderId.toString(),
        error,
      });
    }

    await tx.shopOrder.update({
      where: { id: orderId },
      data: {
        // Payment confirmed -> "paid" ("Payment Completed"), NOT "completed".
        // Fulfillment/finishing the order is a separate, operator-driven step.
        status: PAYMENT_COMPLETED_STATUS,
        completed_at: input.paidAt ? new Date(input.paidAt) : new Date(),
        xendit_status: input.status,
        xendit_payment_id: input.xenditInvoiceId,
        ...(input.paymentMethod
          ? { xendit_payment_method: input.paymentMethod }
          : {}),
      },
    });

    const user = await tx.user.findUnique({
      where: { user_id: order.user_id },
      select: { email: true, first_name: true },
    });
    if (user?.email) {
      emailRecipient = user.email;
      emailPayload = {
        orderNumber: order.order_number,
        customerName: user.first_name ?? "Customer",
        items: order.items.map((it) => ({
          name: it.item_name,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unit_price),
          totalPrice: Number(it.total_price),
          type:
            it.item_type === "subscription_plan"
              ? "subscription"
              : it.item_type === "template" || it.item_type === "custom_theme"
                ? "template"
                : "merchandise",
        })),
        subtotal: Number(order.subtotal),
        discountAmount: Number(order.discount_amount),
        taxAmount: Number(order.tax_amount),
        shippingAmount: Number(order.shipping_amount),
        totalAmount: Number(order.total_amount),
        currency: order.currency ?? "PHP",
        paymentMethod: order.payment_method ?? "xendit",
        shippingAddress: order.shipping_address
          ? parseCustomData(order.shipping_address)
          : null,
      };
    }

    referredUserId = order.user_id;
    orderTotal = Number(order.total_amount);
    for (const item of order.items) {
      const customData = parseCustomData(item.custom_data);
      const affiliate = customData.affiliate;
      if (affiliate && typeof affiliate === "object" && !Array.isArray(affiliate)) {
        affiliateMeta = affiliate as Record<string, unknown>;
        break;
      }
    }
    return "fulfilled" as const;
  });

  if (
    (result === "fulfilled" || result === "already_completed") &&
    referredUserId != null
  ) {
    try {
      await attributePaidShopOrderCommission({
        shopOrderId: orderId,
        buyerUserId: referredUserId,
        orderTotal,
        affiliateMetaFromOrder: affiliateMeta,
      });
    } catch (error) {
      console.warn("[ORDER_FULFILLMENT] Failed to record staff/affiliate commission", {
        orderId: orderId.toString(),
        error,
      });
    }
  }

  if (emailRecipient && emailPayload) {
    try {
      await sendOrderConfirmationEmail(emailRecipient, emailPayload);
    } catch (error) {
      console.warn("[ORDER_FULFILLMENT] Failed to send order confirmation email", {
        orderId: orderId.toString(),
        error,
      });
    }
  }

  if (result === "fulfilled" || result === "already_completed") {
    const uniqueRequestIds = [
      ...new Set(customThemeRequestIdsToForward.map(String)),
    ].map((id) => BigInt(id));
    for (const requestId of uniqueRequestIds) {
      try {
        await forwardPaidCustomThemeRequestToDev(requestId);
      } catch (error) {
        console.warn(
          "[ORDER_FULFILLMENT] Failed to forward custom theme request to dev",
          { requestId: requestId.toString(), error },
        );
      }
    }
  }

  return result;
}
