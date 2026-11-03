import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { generateOrderNumber } from "@/server/lib/payment";
import { createXenditInvoice, getXenditCurrency } from "@/server/lib/xendit";
import { processPaymentIdempotently } from "@/lib/payment-idempotency";
import { PaymentErrorCode, toPaymentErrorResponse } from "@/lib/errors/payment-errors";
import { notifyAssignedStaffForOrder } from "@/server/lib/notifications";
import { calculateProductUnitPrice } from "@/lib/pricing/product-pricing.service";

interface CreateInvoiceBody {
  cart_id?: string;
  success_redirect_url?: string;
  failure_redirect_url?: string;
  customer?: {
    email?: string;
    given_names?: string;
    mobile_number?: string;
  };
}

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, value) => (typeof value === "bigint" ? value.toString() : value)));

function toJsonString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

async function requireSession(request: NextRequest) {
  const result = await resolveRequestSession(request);
  if (!result.session) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Authentication required.", requiresAuth: true }, { status: 401 }),
    };
  }

  return { ok: true as const, session: result.session };
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("marketplace-checkout-create-invoice", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      toPaymentErrorResponse(
        PaymentErrorCode.CHECKOUT_RATE_LIMIT,
        "Too many requests. Please slow down.",
        "unknown",
        { retryAfter: rateCheck.retryAfterMs }
      ),
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (!idempotencyKey || idempotencyKey.length < 10 || idempotencyKey.length > 255) {
    return NextResponse.json(
      toPaymentErrorResponse(
        PaymentErrorCode.IDEMPOTENCY_KEY_INVALID,
        "Valid Idempotency-Key header required (10-255 characters).",
        "unknown"
      ),
      { status: 400 }
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as CreateInvoiceBody;
    const userId = BigInt(auth.session.userId);

    const result = await processPaymentIdempotently(
      {
        idempotencyKey,
        userId,
        action: "checkout_create_invoice",
        payload: body,
      },
      async () => {
        const user = await prisma.user.findUnique({
          where: { user_id: userId },
          select: { first_name: true, email: true },
        });

        if (!user?.email) {
          throw new Error("User email is required for checkout.");
        }

        const cartItems = await prisma.cartItem.findMany({ where: { user_id: userId } });
        if (cartItems.length === 0) {
          throw new Error("Your cart is empty.");
        }

        const merchandiseIds = cartItems.filter((c) => c.item_type === "merchandise").map((c) => c.item_id);
        const templateIds = cartItems.filter((c) => c.item_type === "template").map((c) => c.item_id);
        const planIds = cartItems.filter((c) => c.item_type === "subscription_plan").map((c) => c.item_id);

        const [merchandise, templates, plans] = await Promise.all([
          merchandiseIds.length > 0
            ? prisma.merchandise.findMany({ where: { id: { in: merchandiseIds } } })
            : Promise.resolve([]),
          templateIds.length > 0
            ? prisma.theme.findMany({ where: { id: { in: templateIds } }, select: { id: true, theme_name: true, price: true, tag: true } })
            : Promise.resolve([]),
          planIds.length > 0
            ? prisma.subscriptionPlan.findMany({ where: { id: { in: planIds } } })
            : Promise.resolve([]),
        ]);

        const merchandiseMap = new Map(merchandise.map((m) => [m.id.toString(), m]));
        const templateMap = new Map(templates.map((t) => [t.id.toString(), t]));
        const planMap = new Map(plans.map((p) => [p.id.toString(), p]));

        let totalAmount = 0;
        const lineItems: Array<{ item: (typeof cartItems)[number]; itemName: string; unitPrice: number; lineTotal: number }> = [];

        for (const cartItem of cartItems) {
          const itemId = cartItem.item_id.toString();

          if (cartItem.item_type === "merchandise") {
            const product = merchandiseMap.get(itemId);
            if (!product || !product.is_active) {
              throw new Error(`Product ${itemId} is unavailable.`);
            }

            const recalc = await calculateProductUnitPrice(cartItem.item_id, {
              variant: cartItem.variant,
              subscriptionTier: cartItem.subscription_tier,
              logoType: cartItem.logo_type,
            });
            const unitPrice = recalc.unitPrice;
            const lineTotal = unitPrice * cartItem.quantity;
            totalAmount += lineTotal;
            lineItems.push({ item: cartItem, itemName: product.name, unitPrice, lineTotal });
          }

          if (cartItem.item_type === "template") {
            const template = templateMap.get(itemId);
            if (!template) {
              throw new Error(`Template ${itemId} not found.`);
            }

            const unitPrice = Number(template.price);
            const lineTotal = unitPrice * cartItem.quantity;
            totalAmount += lineTotal;
            lineItems.push({ item: cartItem, itemName: template.theme_name, unitPrice, lineTotal });
          }

          if (cartItem.item_type === "subscription_plan") {
            const plan = planMap.get(itemId);
            if (!plan || !plan.is_active) {
              throw new Error(`Subscription plan ${itemId} is unavailable.`);
            }

            const billingCycle =
              (cartItem.custom_data as Record<string, string> | null)?.billing_cycle === "yearly" ? "yearly" : "monthly";
            const unitPrice = Number(billingCycle === "yearly" ? plan.price_yearly ?? 0 : plan.price_monthly ?? 0);
            const lineTotal = unitPrice * cartItem.quantity;
            totalAmount += lineTotal;
            lineItems.push({ item: cartItem, itemName: plan.name, unitPrice, lineTotal });
          }
        }

        if (totalAmount <= 0) {
          throw new Error("Total amount must be greater than zero.");
        }

        const orderNumber = generateOrderNumber();
        const currency = getXenditCurrency();

        const invoice = await createXenditInvoice({
          externalId: orderNumber,
          amount: totalAmount,
          payerEmail: body.customer?.email || user.email,
          description: `Marketplace order ${orderNumber}`,
          currency,
          successRedirectUrl: body.success_redirect_url,
          failureRedirectUrl: body.failure_redirect_url,
          customer: {
            givenNames: body.customer?.given_names || user.first_name || "Customer",
            email: body.customer?.email || user.email,
            mobileNumber: body.customer?.mobile_number,
          },
          items: lineItems.map((line) => ({
            name: line.itemName,
            quantity: line.item.quantity,
            price: Math.round(line.unitPrice),
            category: line.item.item_type,
          })),
          invoiceDurationSeconds: 86400,
        });

        const order = await prisma.$transaction(async (tx) => {
          const created = await tx.shopOrder.create({
            data: {
              order_number: orderNumber,
              user_id: userId,
              status: "pending_payment",
              subtotal: new Prisma.Decimal(totalAmount),
              discount_amount: new Prisma.Decimal(0),
              tax_amount: new Prisma.Decimal(0),
              shipping_amount: new Prisma.Decimal(0),
              total_amount: new Prisma.Decimal(totalAmount),
              currency,
              payment_method: "xendit",
              payment_id: invoice.id,
              xendit_payment_id: invoice.id,
              xendit_invoice_url: invoice.invoice_url,
              xendit_status: invoice.status,
            },
          });

          for (const line of lineItems) {
            await tx.shopOrderItem.create({
              data: {
                order_id: created.id,
                item_type: line.item.item_type,
                item_id: line.item.item_id,
                item_name: line.itemName,
                quantity: line.item.quantity,
                unit_price: new Prisma.Decimal(line.unitPrice),
                total_price: new Prisma.Decimal(line.lineTotal),
                // keep reference to originating cart item so webhook
                // handlers can clear the exact cart entries after payment success
                custom_data: toJsonString({
                  ...(line.item.custom_data as Record<string, unknown> | null),
                  origin_cart_item_id: line.item.id ? String(line.item.id) : null,
                }),
              },
            });
          }
          // NOTE: do not delete cart items here. Cart items should be cleared
          // only after payment success in the webhook handler to avoid
          // removing items from the cart when the user hasn't completed payment.
          return created;
        });

        void notifyAssignedStaffForOrder(userId, order.id, {
          order_number: order.order_number,
          status: order.status,
        }).catch((error) => console.error("[create-invoice staff notification]", error));

        return {
          order_id: order.id.toString(),
          order_number: order.order_number,
          xendit_invoice_id: invoice.id,
          xendit_invoice_url: invoice.invoice_url,
          expiry_date: invoice.expiry_date,
        };
      }
    );

    if (result.duplicate) {
      return NextResponse.json(
        serialize({
          success: true,
          data: result.result,
          duplicate: true,
        })
      );
    }

    return NextResponse.json(
      serialize({
        success: true,
        data: result.result,
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create Xendit invoice.";
    console.error("[marketplace/checkout/create-invoice POST]", message);

    let errorCode = PaymentErrorCode.INVOICE_CREATION_FAILED;
    let status = 500;

    if (message.includes("cart is empty")) {
      errorCode = PaymentErrorCode.CART_EMPTY;
      status = 400;
    } else if (message.includes("unavailable")) {
      errorCode = PaymentErrorCode.PRODUCT_UNAVAILABLE;
      status = 409;
    } else if (message.includes("Total amount must be greater than zero")) {
      errorCode = PaymentErrorCode.PAYMENT_AMOUNT_INVALID;
      status = 400;
    }

    return NextResponse.json(
      toPaymentErrorResponse(
        errorCode,
        message,
        "unknown",
        { reason: message }
      ),
      { status }
    );
  }
}
