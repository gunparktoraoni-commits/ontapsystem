// app/api/user/billing/payment-methods/route.ts
import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";

async function requireSession(request: NextRequest) {
  const resolved = await resolveRequestSession(request);
  if (!resolved.session) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Authentication required.", requiresAuth: true }, { status: 401 }),
    };
  }
  return { ok: true as const, session: resolved.session };
}

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const userId = BigInt(auth.session.userId);

  // Find any active bizcard subscription that has a payment method id
  const subscription = await prisma.bizcardSubscription.findFirst({
    where: {
      bizcard: { user_id: userId, deactivated_flag: false },
      status: "active",
    },
    select: { payment_method_id: true },
  });

  const method = subscription?.payment_method_id
    ? [{ id: subscription.payment_method_id, type: "tokenized", is_default: true, created_at: null }]
    : [];

  return NextResponse.json({
    success: true,
    data: {
      payment_methods: method,
      default_method_id: method[0]?.id ?? null,
      can_add: false,
      max_methods: 5,
      note: "Full payment method management requires tokenized gateway customer-method APIs.",
    },
  });
}

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: "Adding payment methods is not configured. Tokenized gateway integration is required.",
      code: "PAYMENT_METHODS_NOT_CONFIGURED",
    },
    { status: 501 }
  );
}