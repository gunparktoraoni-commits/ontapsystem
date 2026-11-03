// PUT /api/marketplace/cart/update/[itemId]
// Auth required — updates quantity or custom_data on a cart item.
// Rate limit: 60/min per IP.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { validateCsrfToken } from "@/lib/csrf";
import { validateUpdateCartInput } from "@/server/lib/validators";

const serialize = (obj: unknown): unknown =>
  JSON.parse(
    JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );

async function requireSession(request: NextRequest) {
  const result = await resolveRequestSession(request);
  if (!result.session) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Authentication required.", requiresAuth: true },
        { status: 401 },
      ),
    };
  }
  return { ok: true as const, session: result.session };
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("marketplace-cart-update", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)),
        },
      },
    );
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const csrfValid = await validateCsrfToken(request);
  if (!csrfValid) {
    return NextResponse.json(
      { error: "CSRF validation failed.", code: "INVALID_CSRF_TOKEN" },
      { status: 403 },
    );
  }

  const { session } = auth;

  try {
    const { itemId: rawItemId } = await params;
    let cartItemId: bigint;
    try {
      cartItemId = BigInt(rawItemId);
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid cart item ID." },
        { status: 400 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body." },
        { status: 400 },
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, error: "Invalid request payload." },
        { status: 400 },
      );
    }

    const validation = validateUpdateCartInput(body as Record<string, unknown>);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.errors[0] ?? "Validation failed." },
        { status: 400 },
      );
    }

    const userId = BigInt(session.userId);

    // Verify ownership
    const existing = await prisma.cartItem.findFirst({
      where: {
        id: cartItemId,
        user_id: userId,
        item_type: { in: ["merchandise", "template", "subscription_plan"] },
      },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Cart item not found." },
        { status: 404 },
      );
    }

    const { quantity, customData, note } = validation.data!;

    const updateData: any = {};
    if (quantity !== undefined) updateData.quantity = quantity;
    if (customData !== undefined) {
      updateData.custom_data =
        customData === null ? null : JSON.stringify(customData);
    }
    if (Object.prototype.hasOwnProperty.call(validation.data!, "note")) {
      // allow explicit null to clear note
      updateData.note = note === null ? null : note;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { success: false, error: "No valid fields to update." },
        { status: 400 },
      );
    }

    const updated = await prisma.cartItem.update({
      where: { id: cartItemId },
      data: updateData,
    });

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          cartItem: {
            id: updated.id.toString(),
            itemType: updated.item_type,
            itemId: updated.item_id.toString(),
            quantity: updated.quantity,
            unitPrice: Number(updated.price_at_time),
            lineTotal: Number(updated.price_at_time) * updated.quantity,
            customData: updated.custom_data,
          },
        },
      }),
    );
  } catch (err) {
    console.error("[marketplace/cart/update/[itemId] PUT]", err);
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred." },
      { status: 500 },
    );
  }
}
