import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession } from "@/server/lib/auth";
import { getProductSubscriptionService } from "@/lib/services/product-subscription.service";
import { prisma } from "@/server/lib/prisma";

interface RenewRequest {
  paymentMethod?: string;
  paymentTransactionId?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bizcardId: string }> }
) {
  try {
    const { bizcardId: bizcardIdStr } = await params;
    const resolved = await resolveRequestSession(request);
    if (!resolved.session) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Authentication required" },
        { status: 401 }
      );
    }

    const body: RenewRequest = await request.json();
    const bizcardId = BigInt(bizcardIdStr);
    const userId = BigInt(resolved.session.userId);

    // Verify bizcard belongs to user
    const bizcard = await prisma.bizcard.findFirst({
      where: {
        bizcard_id: bizcardId,
        user_id: userId,
      },
      select: {
        bizcard_id: true,
        subscription_tier: true,
      },
    });

    if (!bizcard) {
      return NextResponse.json(
        { error: "BIZCARD_NOT_FOUND", message: "Bizcard not found" },
        { status: 404 }
      );
    }

    if (!bizcard.subscription_tier) {
      return NextResponse.json(
        {
          error: "NO_SUBSCRIPTION",
          message: "Bizcard does not have an active subscription",
        },
        { status: 400 }
      );
    }

    const subscriptionService = getProductSubscriptionService(
      request.headers.get("x-request-id") ?? "renew-subscription"
    );

    const result = await subscriptionService.renewSubscription(
      bizcardId,
      userId,
      body.paymentMethod,
      body.paymentTransactionId
    );

    return NextResponse.json(
      {
        success: true,
        data: result,
        message: "Subscription renewed successfully",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[bizcard/subscription/renew error]", error);

    const message = error instanceof Error ? error.message : "Failed to renew subscription";
    const status = message.includes("NOT_FOUND") ? 404 : 500;

    return NextResponse.json(
      {
        error: "RENEWAL_FAILED",
        message,
      },
      { status }
    );
  }
}
