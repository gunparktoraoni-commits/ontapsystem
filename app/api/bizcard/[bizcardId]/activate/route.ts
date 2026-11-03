import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession } from "@/server/lib/auth";
import { getProductSubscriptionService } from "@/lib/services/product-subscription.service";
import { prisma } from "@/server/lib/prisma";

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

    const bizcardId = BigInt(bizcardIdStr);
    const userId = BigInt(resolved.session.userId);

    // Verify bizcard belongs to user and is in pending_activation state
    const bizcard = await prisma.bizcard.findFirst({
      where: {
        bizcard_id: bizcardId,
        user_id: userId,
      },
      select: {
        bizcard_id: true,
        bizcard_name: true,
        subscription_status: true,
        product_id: true,
        is_blank: true,
      },
    });

    if (!bizcard) {
      return NextResponse.json(
        {
          error: "BIZCARD_NOT_FOUND",
          message: `Bizcard ${bizcardId} not found or does not belong to user`,
        },
        { status: 404 }
      );
    }

    if (bizcard.subscription_status !== "pending_activation") {
      return NextResponse.json(
        {
          error: "INVALID_STATUS",
          message: `Bizcard subscription is already ${bizcard.subscription_status}, cannot activate`,
        },
        { status: 400 }
      );
    }

    if (!bizcard.product_id) {
      return NextResponse.json(
        {
          error: "MISSING_PRODUCT",
          message: "Bizcard does not have an associated product",
        },
        { status: 400 }
      );
    }

    // Activate the subscription
    const subscriptionService = getProductSubscriptionService(request.headers.get("x-request-id") ?? "activate-bizcard");
    const result = await subscriptionService.activateBizcardSubscription(
      bizcardId,
      userId,
      bizcard.product_id
    );

    return NextResponse.json(
      {
        success: true,
        data: result,
        message: "Subscription activated successfully",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[bizcard/activate error]", error);

    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("NOT_FOUND") ? 404 : 500;

    return NextResponse.json(
      {
        error: "ACTIVATION_FAILED",
        message,
      },
      { status }
    );
  }
}
