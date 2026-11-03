// app/api/marketplace/checkout/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { verifyXenditWebhookToken } from "@/server/lib/xendit";
import { processWebhookOnce } from "@/lib/webhook-idempotency";
import { Prisma } from "@prisma/client";
import { parseJsonArray } from "@/server/lib/json-field";
import { notifyAssignedStaffForOrder } from "@/server/lib/notifications";
import { xenditAmountsMatch } from "@/server/lib/marketplace/order-fulfillment";
import { attributePaidShopOrderCommission } from "@/server/lib/staff-commission";

interface CheckoutLineItem {
  item_type: string;
  item_id: string | number;
  item_name: string;
  quantity: number;
  unit_price: number | string;
  total_price: number | string;
  custom_data?: unknown;
  affiliate?: Record<string, unknown>;
}

interface XenditWebhookPayload {
  id: string;
  external_id: string;
  amount: number;
  payer_email: string;
  description: string;
  currency: string;
  status: "PENDING" | "PAID" | "SETTLED" | "EXPIRED" | "FAILED" | "VOIDED";
  paid_at?: string;
  paid_amount?: number;
  payment_method?: string;
  [key: string]: unknown;
}

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, value) => (typeof value === "bigint" ? value.toString() : value)));

const XENDIT_SUCCESS_STATUSES = new Set(["PAID", "SETTLED"]);
const XENDIT_FAILURE_STATUSES = new Set(["EXPIRED", "FAILED", "VOIDED"]);

function toJsonString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const tokenFromHeader = request.headers.get("x-callback-token");
  if (!verifyXenditWebhookToken(tokenFromHeader)) {
    console.warn("[webhook] Invalid webhook token");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      console.error("[webhook] Failed to parse JSON body");
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      console.error("[webhook] Invalid payload structure");
      return NextResponse.json({ error: "Invalid payload structure." }, { status: 400 });
    }

    const data = payload as XenditWebhookPayload;
    const eventId = data.id?.trim();
    const xenditInvoiceId = data.id?.trim();
    const externalId = data.external_id?.trim();
    const normalizedStatus = data.status?.trim().toUpperCase();

    if (!eventId || !normalizedStatus) {
      console.error("[webhook] Missing required fields", { eventId, normalizedStatus });
      return NextResponse.json({ error: "Missing required webhook fields." }, { status: 400 });
    }

    console.log(
      `[webhook] Received event ${eventId} for invoice ${xenditInvoiceId}, external ${externalId}, status ${normalizedStatus}`,
    );

    const result = await processWebhookOnce(
      {
        provider: "xendit",
        eventId,
        eventType: normalizedStatus,
        idempotencyKey: `xendit:${xenditInvoiceId}:${eventId}`,
        metadata: {
          invoiceId: xenditInvoiceId,
          externalId,
          amount: data.amount,
          paidAmount: data.paid_amount,
          paymentMethod: data.payment_method,
        },
      },
      async () => {
        // ── 1. Find CheckoutSession by Xendit invoice id (data.id) ────────
        let checkoutSession = xenditInvoiceId
          ? await prisma.checkoutSession.findFirst({
              where: {
                invoice_id: xenditInvoiceId,
                status: { in: ["pending", "processing"] },
              },
            })
          : null;

        if (!checkoutSession && xenditInvoiceId) {
          checkoutSession = await prisma.checkoutSession.findFirst({
            where: { invoice_id: xenditInvoiceId },
          });
        }

        // Backward compatibility: older sessions may have stored external_id
        if (!checkoutSession && externalId) {
          checkoutSession = await prisma.checkoutSession.findFirst({
            where: { invoice_id: externalId },
          });
        }

        if (!checkoutSession) {
          console.warn(
            `[webhook] CheckoutSession not found for invoice: ${xenditInvoiceId ?? externalId}`,
          );
          return { ignored: "checkout_session_not_found" };
        }

        console.log(
          `[webhook] Found CheckoutSession ${checkoutSession.session_id} for invoice ${xenditInvoiceId}`,
        );

        // ── 2. Handle successful payment ────────────────────────────────────
        if (XENDIT_SUCCESS_STATUSES.has(normalizedStatus)) {
          if (checkoutSession.status === "completed") {
            console.log(`[webhook] CheckoutSession ${checkoutSession.session_id} already completed – skipping`);
            return { ignored: "already_completed" };
          }

          // ── Verify the amount actually paid matches what we expected ──────
          // Never turn a partial/underpaid invoice into a paid order.
          const expectedAmount = Number(checkoutSession.total_amount);
          const receivedAmount = Number(data.paid_amount ?? data.amount ?? 0);
          if (!xenditAmountsMatch(receivedAmount, expectedAmount)) {
            await prisma.checkoutSession.update({
              where: { id: checkoutSession.id },
              data: { status: "failed", updated_at: new Date() },
            });
            console.warn(
              `[webhook] Amount mismatch for session ${checkoutSession.session_id}: expected ${expectedAmount}, received ${receivedAmount}`,
            );
            return { ignored: "amount_mismatch", invoiceId: xenditInvoiceId };
          }

          // ── Verify currency matches to avoid cross-currency confusion ─────
          const expectedCurrency = (checkoutSession.currency ?? "PHP").toUpperCase();
          const receivedCurrency = (data.currency ?? expectedCurrency).toUpperCase();
          if (receivedCurrency !== expectedCurrency) {
            await prisma.checkoutSession.update({
              where: { id: checkoutSession.id },
              data: { status: "failed", updated_at: new Date() },
            });
            console.warn(
              `[webhook] Currency mismatch for session ${checkoutSession.session_id}: expected ${expectedCurrency}, received ${receivedCurrency}`,
            );
            return { ignored: "currency_mismatch", invoiceId: xenditInvoiceId };
          }

          const orderData = await prisma.$transaction(async (tx) => {
            const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

            const shippingAddressStr = toJsonString(checkoutSession.shipping_address) ?? "{}";
            const billingAddressStr = toJsonString(checkoutSession.billing_address) ?? "{}";

            const paidAt = data.paid_at ? new Date(data.paid_at) : new Date();

            const newOrder = await tx.shopOrder.create({
              data: {
                order_number: orderNumber,
                user_id: checkoutSession.user_id,
                status: "paid",
                completed_at: paidAt,
                subtotal: checkoutSession.subtotal,
                discount_amount: checkoutSession.discount_amount,
                tax_amount: checkoutSession.tax_amount,
                shipping_amount: checkoutSession.shipping_amount,
                total_amount: checkoutSession.total_amount,
                currency: checkoutSession.currency ?? "PHP",
                payment_method: "xendit",
                payment_id: eventId,
                promo_id: checkoutSession.promo_id,
                shipping_address: shippingAddressStr,
                billing_address: billingAddressStr,
                notes: checkoutSession.notes,
                xendit_invoice_id: xenditInvoiceId ?? externalId ?? null,
                xendit_payment_id: eventId,
                xendit_status: normalizedStatus,
                xendit_payment_method: data.payment_method || "xendit",
                placed_at: new Date(),
              },
            });

            const lineItems = parseJsonArray<CheckoutLineItem>(checkoutSession.line_items);
            for (const item of lineItems) {
              await tx.shopOrderItem.create({
                data: {
                  order_id: newOrder.id,
                  item_type: item.item_type,
                  item_id: BigInt(item.item_id),
                  item_name: item.item_name,
                  quantity: item.quantity,
                  unit_price: new Prisma.Decimal(item.unit_price),
                  total_price: new Prisma.Decimal(item.total_price),
                  custom_data: item.custom_data ? JSON.stringify(item.custom_data) : null,
                },
              });
            }

            if (lineItems.length) {
              await tx.purchaseLog.createMany({
                data: lineItems.map((item: any) => ({
                  user_id: checkoutSession.user_id,
                  purchase_type: item.item_type,
                  item_id: BigInt(item.item_id),
                  item_name: item.item_name,
                  amount: new Prisma.Decimal(item.total_price),
                  order_id: newOrder.id,
                  metadata: item.affiliate ? JSON.stringify(item.affiliate) : null,
                })),
              });
            }

            const templateItems = lineItems.filter((item: any) => item.item_type === "template");
            for (const item of templateItems) {
              await tx.templatePurchase.create({
                data: {
                  user_id: checkoutSession.user_id,
                  template_id: BigInt(item.item_id),
                  price_paid: new Prisma.Decimal(item.unit_price),
                  order_id: newOrder.id,
                },
              });
            }

            // ── CLEAR CART ITEMS (improved) ─────────────────────────────────
            try {
              let idsToDelete: bigint[] = [];

              // Method 1: cart_snapshot
              const cartSnapshot = checkoutSession.cart_snapshot
                ? (typeof checkoutSession.cart_snapshot === "string"
                    ? JSON.parse(checkoutSession.cart_snapshot)
                    : checkoutSession.cart_snapshot)
                : null;

              if (Array.isArray(cartSnapshot) && cartSnapshot.length) {
                idsToDelete = cartSnapshot
                  .map((ci: any) => ci.id)
                  .filter((id: string | number) => id != null)
                  .map((id: string | number) => BigInt(id));
                console.log(`[webhook] Found ${idsToDelete.length} cart item IDs from cart_snapshot`);
              }

              // Method 2: origin_cart_item_id from line items (fallback)
              if (idsToDelete.length === 0) {
                for (const item of lineItems) {
                  const customData = item.custom_data
                    ? (typeof item.custom_data === "string" ? JSON.parse(item.custom_data) : item.custom_data)
                    : null;
                  const originId = customData?.origin_cart_item_id;
                  if (originId) {
                    try {
                      idsToDelete.push(BigInt(originId));
                    } catch (e) {
                      console.warn(`[webhook] Invalid origin_cart_item_id: ${originId}`);
                    }
                  }
                }
                console.log(`[webhook] Found ${idsToDelete.length} cart item IDs from line_items fallback`);
              }

              if (idsToDelete.length > 0) {
                const deleted = await tx.cartItem.deleteMany({
                  where: {
                    user_id: checkoutSession.user_id,
                    id: { in: idsToDelete },
                  },
                });
                console.log(`[webhook] Deleted ${deleted.count} cart items for user ${checkoutSession.user_id}`);
              } else {
                console.warn(`[webhook] No cart item IDs to delete for session ${checkoutSession.session_id}`);
              }
            } catch (e) {
              console.error("[webhook] Failed to clear cart items", e);
            }

            await tx.checkoutSession.update({
              where: { id: checkoutSession.id },
              data: {
                status: "completed",
                order_id: newOrder.id,
                updated_at: new Date(),
              },
            });

            console.log(`[webhook] Order ${orderNumber} created successfully`);
            return { success: true, order: newOrder };
          });

          return orderData;
        }

        // ── 3. Handle failed payment ────────────────────────────────────────
        if (XENDIT_FAILURE_STATUSES.has(normalizedStatus)) {
          await prisma.checkoutSession.update({
            where: { id: checkoutSession.id },
            data: {
              status: "failed",
              updated_at: new Date(),
            },
          });
          console.log(`[webhook] CheckoutSession ${checkoutSession.session_id} marked as failed (${normalizedStatus})`);
          return { ignored: "payment_failed", invoiceId: xenditInvoiceId };
        }

        if (normalizedStatus === "PENDING") {
          console.log(`[webhook] Invoice ${xenditInvoiceId} still pending`);
          return { ignored: "payment_pending" };
        }

        return { ignored: "unknown_status" };
      }
    );

    if (
      result.result &&
      typeof result.result === "object" &&
      "success" in result.result &&
      result.result.success === true &&
      "order" in result.result &&
      result.result.order &&
      typeof result.result.order === "object"
    ) {
      const createdOrder = result.result.order as {
        id: bigint;
        user_id: bigint;
        order_number: string;
        status: string;
        total_amount: { toString(): string } | number | string;
      };
      void notifyAssignedStaffForOrder(createdOrder.user_id, createdOrder.id, {
        order_number: createdOrder.order_number,
        status: createdOrder.status,
      }).catch((error) => console.error("[webhook staff notification]", error));

      void (async () => {
        try {
          const orderItems = await prisma.shopOrderItem.findMany({
            where: { order_id: createdOrder.id },
            select: { custom_data: true },
          });
          let affiliateMeta: Record<string, unknown> | null = null;
          for (const item of orderItems) {
            if (!item.custom_data) continue;
            try {
              const parsed =
                typeof item.custom_data === "string"
                  ? JSON.parse(item.custom_data)
                  : item.custom_data;
              const affiliate =
                parsed && typeof parsed === "object"
                  ? (parsed as Record<string, unknown>).affiliate
                  : null;
              if (affiliate && typeof affiliate === "object") {
                affiliateMeta = affiliate as Record<string, unknown>;
                break;
              }
            } catch {
              // skip malformed custom_data
            }
          }

          // Prefer the persisted shop order total (same source used by other checkout paths).
          let orderTotal = Number(createdOrder.total_amount) || 0;
          if (!affiliateMeta) {
            const session = await prisma.checkoutSession.findFirst({
              where: { order_id: createdOrder.id },
              select: { line_items: true, total_amount: true },
            });
            const sessionLines = parseJsonArray<CheckoutLineItem>(
              session?.line_items as string | null,
            );
            for (const line of sessionLines) {
              if (line.affiliate && typeof line.affiliate === "object") {
                affiliateMeta = line.affiliate;
                break;
              }
              const custom =
                line.custom_data && typeof line.custom_data === "object"
                  ? (line.custom_data as Record<string, unknown>)
                  : null;
              if (custom?.affiliate && typeof custom.affiliate === "object") {
                affiliateMeta = custom.affiliate as Record<string, unknown>;
                break;
              }
            }
            if (session?.total_amount != null) {
              orderTotal = Number(session.total_amount) || orderTotal;
            }
          }

          await attributePaidShopOrderCommission({
            shopOrderId: createdOrder.id,
            buyerUserId: createdOrder.user_id,
            orderTotal,
            affiliateMetaFromOrder: affiliateMeta,
          });
        } catch (error) {
          console.error("[webhook] staff/affiliate commission failed", error);
        }
      })();
    }

    if (result.duplicate) {
      return NextResponse.json(
        serialize({
          success: true,
          received: true,
          duplicate: true,
          message: "Duplicate webhook event ignored.",
        })
      );
    }

    return NextResponse.json(
      serialize({
        success: true,
        received: true,
        processed:
          result.result && typeof result.result === "object" && "success" in result.result && result.result.success === true,
        message:
          result.result && typeof result.result === "object" && "ignored" in result.result
            ? `Event ignored: ${(result.result as any).ignored}`
            : "Payment processed",
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[webhook] Unhandled exception", message, error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}